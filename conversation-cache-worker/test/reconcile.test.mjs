// Regression tests for the ghost-card deletion-reconcile fix (2026-07-02).
//
// ROOT CAUSE this guards against: 23 prospect contacts were deleted from GHL, but
// their Follow-Up cards stayed on the due list (coach:due:latest) through three
// daily rebuilds. deriveCadence builds a card from the cached conv:{id} touches,
// and a deleted contact simply disappears from the /contacts LIST (reads as
// partnerStage=undefined) — nothing ever verified the id still exists or purged
// the stale conv:/coach:/call-coach: keys. Staff could keep calling the dead.
//
// The fix verifies a bounded batch of the due-list against GHL each run and, on
// an EXPLICIT 404/410 only, drops the contact and purges its keys. Two layers:
//   1. classifyFetchError() — a fetch failure is a deletion ONLY on 404/410;
//      every transient error (5xx/429/408/network) leaves the contact untouched.
//   2. reconcileDeletions() — end-to-end: a 404'd contact is excluded from
//      coach:due:latest and its keys deleted; a 429/500'd contact is KEPT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFetchError, reconcileDeletions } from "../src/reconcile.js";

// ── classifyFetchError ───────────────────────────────────────────────────────

test("classifyFetchError: an explicit 404 is a confirmed deletion", () => {
  assert.equal(classifyFetchError(new Error("GHL API 404: not found")), "deleted");
});

test("classifyFetchError: a 410 Gone is a confirmed deletion", () => {
  assert.equal(classifyFetchError(new Error("GHL API 410: gone")), "deleted");
});

test("classifyFetchError: 429/500/502/408 are transient — NEVER a deletion", () => {
  for (const s of [408, 429, 500, 502, 503, 504]) {
    assert.equal(classifyFetchError(new Error(`GHL API ${s}: upstream`)), "error", `status ${s}`);
  }
});

test("classifyFetchError: 401/403 (auth) is NOT a deletion", () => {
  assert.equal(classifyFetchError(new Error("GHL API 401: unauthorized")), "error");
  assert.equal(classifyFetchError(new Error("GHL API 403: forbidden")), "error");
});

test("classifyFetchError: a network/transport error is NOT a deletion", () => {
  assert.equal(classifyFetchError(new Error("fetch failed")), "error");
  assert.equal(classifyFetchError(new TypeError("network error")), "error");
});

test("classifyFetchError: GHL 400 'Contact not found' IS a deletion (GHL uses 400, not 404)", () => {
  // 2026-07-03: GHL returns 400 with this body for a deleted/invalid contact id.
  assert.equal(
    classifyFetchError(new Error('GHL API 400: {"message":"Contact not found for id:C6KYbobsL15perMfrg9j"}')),
    "deleted"
  );
  assert.equal(classifyFetchError(new Error("GHL API 400: contact not found")), "deleted");
});

test("classifyFetchError: a generic 400 (real bad request) is NOT a deletion", () => {
  // Only the not-found body counts — any other 400 stays an error, never a purge.
  assert.equal(classifyFetchError(new Error('GHL API 400: {"message":"Invalid query parameter"}')), "error");
  assert.equal(classifyFetchError(new Error("GHL API 400: bad request")), "error");
});

test("classifyFetchError: does NOT match '404' as a substring of a body/id", () => {
  // Guard the same class of bug isRetryable had: 404 inside a 400 body is not a delete.
  assert.equal(classifyFetchError(new Error('GHL API 400: {"message":"bad id abc404def"}')), "error");
});

// ── reconcileDeletions (end to end) ──────────────────────────────────────────

// In-memory KV supporting get(key)/get(key,"json")/put/delete.
function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.has(key) ? store.get(key) : null;
      if (v == null) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

// env whose GHL /contacts/{id} verdict is driven by a per-id map:
//   "ok"  -> 200 (alive), "404"/"410" -> deleted, "500"/"429" -> transient error
function fakeEnv(kv, contactVerdicts) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    // token endpoints never hit — token is seeded fresh in KV.
    const m = u.match(/\/contacts\/([^/?]+)/);
    const id = m ? m[1] : null;
    const verdict = id ? contactVerdicts[id] : undefined;
    if (verdict === "ok" || verdict === undefined) {
      return { ok: true, status: 200, async json() { return { contact: { id } }; }, async text() { return ""; } };
    }
    const status = Number(verdict);
    return { ok: false, status, async text() { return `err ${status}`; }, async json() { return {}; } };
  };
  return {
    GHL_RETRY_BASE_MS: 1,
    PORTAL_KV: Object.assign(kv, {
      // token reads getAccessToken needs (fresh, so no refresh POST fires)
      get: (orig => async (key, type) => {
        if (key === "ghl_access_token") return "tok";
        if (key === "ghl_token_expiry") return String(Date.now() + 3600_000);
        return orig(key, type);
      })(kv.get.bind(kv)),
    }),
  };
}

function seedDue(ids) {
  return JSON.stringify({
    generatedAt: "2026-07-02", generatedAtISO: "2026-07-02T15:20:00.000Z",
    activeContacts: ids.length, prospects: ids.length,
    due: ids.map((id, i) => ({ contactId: id, name: `Name ${id}`, state: "no-reply", due: true, priority: 60 - i })),
    counts: { "no-reply": ids.length },
  });
}

test("reconcileDeletions: a 404'd due contact is dropped and its keys purged", async () => {
  const kv = fakeKV({
    "coach:due:latest": seedDue(["ghost", "alive"]),
    "conv:index": JSON.stringify({ ghost: 111, alive: 222, other: 333 }),
    "conv:ghost": JSON.stringify({ contactId: "ghost", touches: [] }),
    "coach:ghost": JSON.stringify({ contactId: "ghost" }),
    "call-coach:latest:ghost": JSON.stringify({ contactId: "ghost" }),
    "conv:alive": JSON.stringify({ contactId: "alive", touches: [] }),
  });
  const env = fakeEnv(kv, { ghost: "404", alive: "ok" });

  const res = await reconcileDeletions(env);

  assert.equal(res.deletedCount, 1);
  assert.deepEqual(res.deletedIds, ["ghost"]);
  // due-list rewritten without the ghost
  const due = JSON.parse(kv.store.get("coach:due:latest")).due;
  assert.deepEqual(due.map((d) => d.contactId), ["alive"]);
  // ghost keys purged
  assert.equal(kv.store.has("conv:ghost"), false);
  assert.equal(kv.store.has("coach:ghost"), false);
  assert.equal(kv.store.has("call-coach:latest:ghost"), false);
  // pruned from conv:index (unrelated entries survive)
  const index = JSON.parse(kv.store.get("conv:index"));
  assert.equal("ghost" in index, false);
  assert.equal(index.alive, 222);
  assert.equal(index.other, 333);
  // alive contact untouched
  assert.equal(kv.store.has("conv:alive"), true);
  // status summary written
  assert.ok(kv.store.has("ops:coach-reconcile:lastRun"));
});

test("reconcileDeletions: a transient (500/429) contact is KEPT untouched", async () => {
  const kv = fakeKV({
    "coach:due:latest": seedDue(["flaky", "throttled"]),
    "conv:index": JSON.stringify({ flaky: 111, throttled: 222 }),
    "conv:flaky": JSON.stringify({ contactId: "flaky", touches: [] }),
    "coach:flaky": JSON.stringify({ contactId: "flaky" }),
    "conv:throttled": JSON.stringify({ contactId: "throttled", touches: [] }),
  });
  const env = fakeEnv(kv, { flaky: "500", throttled: "429" });

  const res = await reconcileDeletions(env);

  assert.equal(res.deletedCount, 0);
  assert.equal(res.errorCount, 2);
  // due-list unchanged — both still present
  const due = JSON.parse(kv.store.get("coach:due:latest")).due;
  assert.deepEqual(due.map((d) => d.contactId).sort(), ["flaky", "throttled"]);
  // no keys deleted
  assert.equal(kv.store.has("conv:flaky"), true);
  assert.equal(kv.store.has("coach:flaky"), true);
  assert.equal(kv.store.has("conv:throttled"), true);
  // conv:index untouched
  const index = JSON.parse(kv.store.get("conv:index"));
  assert.equal(index.flaky, 111);
  assert.equal(index.throttled, 222);
});

test("reconcileDeletions: mixed batch — only the 404 is purged, others survive", async () => {
  const kv = fakeKV({
    "coach:due:latest": seedDue(["ghost", "flaky", "alive"]),
    "conv:index": JSON.stringify({ ghost: 1, flaky: 2, alive: 3 }),
    "conv:ghost": "{}", "coach:ghost": "{}", "call-coach:latest:ghost": "{}",
    "conv:flaky": "{}", "conv:alive": "{}",
  });
  const env = fakeEnv(kv, { ghost: "404", flaky: "503", alive: "ok" });

  const res = await reconcileDeletions(env);

  assert.deepEqual(res.deletedIds, ["ghost"]);
  const due = JSON.parse(kv.store.get("coach:due:latest")).due.map((d) => d.contactId).sort();
  assert.deepEqual(due, ["alive", "flaky"]);
  assert.equal(kv.store.has("conv:ghost"), false);
  assert.equal(kv.store.has("conv:flaky"), true);
  assert.equal(kv.store.has("conv:alive"), true);
});

test("reconcileDeletions: empty/missing due list is a safe no-op", async () => {
  const kv = fakeKV({});
  const env = fakeEnv(kv, {});
  const res = await reconcileDeletions(env);
  assert.equal(res.deletedCount, 0);
  assert.equal(res.checked, 0);
});

test("reconcileDeletions: honors a bounded batch and rotates the cursor", async () => {
  // 3 due contacts, batch of 2 → only 2 checked this run; cursor advances so the
  // next run covers the rest. Bounds subrequest cost regardless of due-list size.
  const kv = fakeKV({
    "coach:due:latest": seedDue(["a", "b", "c"]),
    "conv:index": JSON.stringify({ a: 1, b: 2, c: 3 }),
  });
  const env = fakeEnv(kv, { a: "ok", b: "ok", c: "ok" });
  const res = await reconcileDeletions(env, { batch: 2 });
  assert.equal(res.checked, 2);
  assert.equal(Number(kv.store.get("coach:reconcile:cursor")), 2);
});

test("reconcileDeletions: circuit breaker refuses a mass-deletion misfire", async () => {
  // If the batch comes back overwhelmingly 404 (a systemic path/auth bug rather
  // than a real purge), refuse the destructive step and leave everything for a
  // human. Guards blast radius while still auto-handling realistic deletions.
  const ids = Array.from({ length: 60 }, (_, i) => `x${i}`);
  const seed = { "coach:due:latest": seedDue(ids), "conv:index": JSON.stringify(Object.fromEntries(ids.map((id) => [id, 1]))) };
  for (const id of ids) seed[`conv:${id}`] = "{}";
  const kv = fakeKV(seed);
  const env = fakeEnv(kv, Object.fromEntries(ids.map((id) => [id, "404"])));
  const res = await reconcileDeletions(env, { batch: 200 });
  assert.equal(res.deletedCount, 0, "must not delete when the breaker trips");
  assert.ok(res.skippedReason);
  // nothing purged
  assert.equal(kv.store.has("conv:x0"), true);
  assert.equal(JSON.parse(kv.store.get("coach:due:latest")).due.length, 60);
});

test("reconcileDeletions: circuit breaker fires on the DEFAULT cron batch (not just an oversized manual batch)", async () => {
  // Regression for the dead-breaker bug (cold review 2026-07-03): the old floor of 50
  // exceeded the default batch of 40, so on the real cron path the breaker could never
  // fire and a mass-404 would strip the whole due-list. Here every contact in a full
  // default-size batch 404s → the breaker must refuse the purge with NO batch override.
  const ids = Array.from({ length: 40 }, (_, i) => `d${i}`);
  const seed = { "coach:due:latest": seedDue(ids), "conv:index": JSON.stringify(Object.fromEntries(ids.map((id) => [id, 1]))) };
  for (const id of ids) seed[`conv:${id}`] = "{}";
  const kv = fakeKV(seed);
  const env = fakeEnv(kv, Object.fromEntries(ids.map((id) => [id, "404"])));
  const res = await reconcileDeletions(env); // DEFAULT batch — the shipped cron path
  assert.equal(res.deletedCount, 0, "breaker must fire at the default batch, not only at batch:200");
  assert.ok(res.skippedReason, "must record why it refused");
  assert.equal(kv.store.has("conv:d0"), true, "no keys purged when the breaker trips");
  assert.equal(JSON.parse(kv.store.get("coach:due:latest")).due.length, 40, "due-list untouched");
});
