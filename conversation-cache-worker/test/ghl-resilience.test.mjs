// Regression tests for the disposition-meta resilience fix (2026-06-17).
//
// ROOT CAUSE this guards against: GHL's list endpoint returns 400 "Request Timeout
// after 30000ms" under load. The old ghlRetry only retried on /429/, so it threw
// immediately on the timeout; loadContactMeta's `catch { break }` then silently
// truncated pagination, and deriveCadence wrote coach:due from PARTIAL disposition
// meta — so dropped/booked contacts (Steve Grubbs, the booked five) flooded the
// due-list. Two layers under test:
//   1. isRetryable() — what counts as a transient GHL error worth retrying.
//   2. loadContactMeta() — must report `complete:false` when a page fails after
//      retries, so deriveCadence can keep last-known-good instead of clobbering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryable } from "../src/ghl.js";
import { loadContactMeta } from "../src/cadence.js";

// ── isRetryable ──────────────────────────────────────────────────────────────

test("isRetryable: 429 rate-limit retries", () => {
  assert.equal(isRetryable(new Error("GHL API 429: rate limited")), true);
});

test("isRetryable: the live 400 'Request Timeout' GHL returns under load retries", () => {
  assert.equal(
    isRetryable(new Error('GHL API 400: {"message":"Request Timeout after 30000ms","error":"Bad Request","statusCode":400}')),
    true,
  );
});

test("isRetryable: 5xx (502/503/504) retries", () => {
  for (const s of [500, 502, 503, 504]) {
    assert.equal(isRetryable(new Error(`GHL API ${s}: upstream`)), true, `status ${s}`);
  }
});

test("isRetryable: 408 Request Timeout retries", () => {
  assert.equal(isRetryable(new Error("GHL API 408: timeout")), true);
});

test("isRetryable: a genuine 400 bad-request does NOT retry (no infinite loop)", () => {
  assert.equal(isRetryable(new Error('GHL API 400: {"message":"Contact id search not found"}')), false);
});

test("isRetryable: 404 does NOT retry", () => {
  assert.equal(isRetryable(new Error("GHL API 404: not found")), false);
});

test("isRetryable: 401 does NOT retry (auth, not transient)", () => {
  assert.equal(isRetryable(new Error("GHL API 401: unauthorized")), false);
});

test("isRetryable: does NOT match '429' as a substring of an id/trace in a non-retryable body", () => {
  // The old /429/.test() matched 429 anywhere — e.g. a 400 whose body merely
  // contains a contactId like 'abc429def' would have been retried forever.
  assert.equal(isRetryable(new Error('GHL API 400: {"message":"bad contact abc429def"}')), false);
});

test("isRetryable: network/transport errors retry", () => {
  assert.equal(isRetryable(new Error("fetch failed")), true);
  assert.equal(isRetryable(new TypeError("network error")), true);
});

// ── loadContactMeta completeness ─────────────────────────────────────────────

// Build a fake env whose global fetch we control via a per-call handler.
function fakeEnv() {
  return {
    GHL_RETRY_BASE_MS: 1, // keep backoff near-instant in tests (prod default 600ms)
    PORTAL_KV: {
      get: async (k) => {
        if (k === "ghl_access_token") return "tok";
        if (k === "ghl_token_expiry") return String(Date.now() + 3600_000);
        return null;
      },
      put: async () => {},
    },
  };
}

// A FULL page = 100 contacts + a cursor → the loop keeps paginating. Only a page
// with <100 contacts (or no cursor) ends pagination naturally.
function fullPage(prefix, cursor) {
  const contacts = Array.from({ length: 100 }, (_, i) => ({ id: `${prefix}${i}`, tags: [], customFields: [] }));
  return {
    ok: true, status: 200,
    async json() { return { contacts, meta: { startAfterId: cursor, startAfter: 1 } }; },
    async text() { return ""; },
  };
}
function lastPage(contacts) {
  return {
    ok: true, status: 200,
    async json() { return { contacts, meta: {} }; }, // no cursor → end
    async text() { return ""; },
  };
}
function errResponse(status, body) {
  return { ok: false, status, async text() { return body; }, async json() { return {}; } };
}

test("loadContactMeta: all pages OK → complete:true, full map", async () => {
  const pages = [
    fullPage("p1_", "cur1"),
    lastPage([{ id: "z", tags: [], customFields: [] }]),
  ];
  let i = 0;
  globalThis.fetch = async () => pages[i++];
  const res = await loadContactMeta(fakeEnv());
  assert.equal(res.complete, true);
  assert.equal(res.map.size, 101);
  assert.ok(res.map.has("p1_0") && res.map.has("z"));
});

test("loadContactMeta: a page that fails every retry → complete:false (don't clobber)", async () => {
  // First page OK (full → continues), then every retry of page 2 is a 400 timeout.
  // With the old code this silently `break`ed and returned the partial map as if
  // complete; now it must flag incomplete.
  let firstServed = false;
  globalThis.fetch = async () => {
    if (!firstServed) { firstServed = true; return fullPage("p1_", "cur1"); }
    return errResponse(400, '{"message":"Request Timeout after 30000ms"}');
  };
  const res = await loadContactMeta(fakeEnv());
  assert.equal(res.complete, false, "must report incomplete when a page fails after retries");
});

test("loadContactMeta: a transient timeout that then succeeds is retried, stays complete", async () => {
  // page1 full(cursor) → page2 times out ONCE then succeeds(last). Should retry
  // through and finish complete with all 101 contacts.
  const seq = [
    fullPage("p1_", "cur1"),
    errResponse(400, '{"message":"Request Timeout after 30000ms"}'),
    lastPage([{ id: "z", tags: [], customFields: [] }]),
  ];
  let i = 0;
  globalThis.fetch = async () => seq[i++];
  const res = await loadContactMeta(fakeEnv());
  assert.equal(res.complete, true);
  assert.equal(res.map.size, 101);
});
