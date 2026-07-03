// Ghost-card deletion reconcile.
//
// A contact deleted from GHL leaves stale cache behind: its conv:{id} touch
// history keeps deriveCadence rebuilding a due-list card every run, and its
// coach:{id} / call-coach:latest:{id} coaching keys linger — so staff keep seeing
// a Follow-Up card for someone who no longer exists. That's exactly what bit us on
// 2026-07-02: 23 deleted prospects stayed on coach:due:latest through three daily
// rebuilds because nothing reconciled the cache against contact deletion, and the
// stale KV had to be purged by hand.
//
// This runs right after deriveCadence on every conversation-cache cron: it verifies
// a BOUNDED batch of the freshly-written due-list against GHL and, on a CONFIRMED
// deletion only, drops the contact from coach:due:latest and purges its keys.
//
// HARD RULE (mirrors functions/lib/session-ledger.js deriveLedger's fetchFailures
// guard — a partial/failed GHL fetch must NEVER derive a destructive conclusion):
// a contact is treated as deleted ONLY on an explicit 404/410 from GET /contacts/{id}.
// Any transient error (5xx / 429 / 408 / network) or a 200 leaves it fully untouched.
//
// COST: each check is a single /contacts/{id} subrequest. We cap at RECONCILE_BATCH
// per run and rotate a cursor (coach:reconcile:cursor) through the due-list, so cost
// is bounded (~40 subrequests, far under the ~1000/invocation paid-tier cap) no
// matter how long the due-list gets. The 3-hourly cron sweeps a typical due-list
// (tens of contacts) whole every run, bounding a ghost's lifetime to one cron cycle
// (~3h) — well inside the "about a day" target — and to <1 day even for a large list.

import { ghlRetry } from "./ghl.js";

// Max contacts verified per run. Comfortably exceeds a typical due-list, so the
// whole list is usually checked every run; larger lists are swept via the cursor.
const RECONCILE_BATCH = 40;

// Circuit breaker: if a run's confirmed-deletions exceed BOTH a small absolute minimum
// AND a high fraction of the batch, treat it as a systemic misfire (auth/path bug
// returning 404 for everything) rather than a real purge, and refuse the destructive
// step — leave it for a human. The fraction (0.8) is the real gate; BREAKER_MIN just
// keeps a tiny batch (e.g. a 1-contact manual run) from ever tripping it.
// IMPORTANT: BREAKER_MIN must stay well BELOW RECONCILE_BATCH or the breaker is dead
// code on the cron path (an earlier floor of 50 > the batch of 40 could never fire).
// A real bulk deletion like the 23-contact incident (23/40 = 58% < 80%) stays under the
// fraction and is still auto-purged; only an implausible ~all-404 sweep is punted.
const BREAKER_MIN = 5;
const BREAKER_FRACTION = 0.8;

// A fetch failure is a CONFIRMED deletion only on an explicit 404/410, OR a 400 whose
// body says "Contact not found" — GHL returns `400 {"message":"Contact not found for
// id:X"}` for a deleted/invalid contact id, NOT a 404 (2026-07-03: this slipped past the
// 404-only check and left deleted contacts stuck on the due list). Everything else —
// transient upstream (5xx/429/408), auth (401/403), transport (network), or any OTHER
// 400 (a genuine bad request) — is "error": do NOT treat it as a delete. Parse the status
// EXACTLY (anchored), and gate the 400 case on the specific not-found body so a normal
// bad-request never triggers a purge.
export function classifyFetchError(err) {
  const msg = String(err?.message ?? err ?? "");
  const m = msg.match(/^GHL API (\d+):/);
  if (m) {
    const status = Number(m[1]);
    if (status === 404 || status === 410) return "deleted";
    if (status === 400 && /contact not found/i.test(msg)) return "deleted";
  }
  return "error";
}

// Verify one contact against GHL. "alive" (200), "deleted" (explicit 404/410), or
// "error" (transient/auth/transport — leave untouched). ghlRetry already burns its
// retries on transient errors before throwing, so reaching the catch with a non-404
// means a genuine hard failure, not a blip.
async function verifyContact(env, id) {
  try {
    await ghlRetry(env, `/contacts/${id}`);
    return "alive";
  } catch (e) {
    return classifyFetchError(e);
  }
}

// Purge every cached key derived from a now-deleted contact. Idempotent (delete of a
// missing key is a no-op), so a partial previous run is safe to repeat.
async function purgeContact(kv, id) {
  await kv.delete(`conv:${id}`);
  await kv.delete(`coach:${id}`);
  await kv.delete(`call-coach:latest:${id}`);
}

export async function reconcileDeletions(env, { batch = RECONCILE_BATCH } = {}) {
  const kv = env.PORTAL_KV;
  const start = Date.now();

  const dueDoc = await kv.get("coach:due:latest", "json");
  const due = Array.isArray(dueDoc?.due) ? dueDoc.due : [];
  const ids = [...new Set(due.map((d) => d.contactId).filter(Boolean))];
  if (!ids.length) {
    const summary = { ranAt: new Date(start).toISOString(), checked: 0, deletedCount: 0, errorCount: 0, deletedIds: [], reason: "no-due-list", durationMs: Date.now() - start };
    await kv.put("ops:coach-reconcile:lastRun", JSON.stringify(summary));
    return summary;
  }

  // Rotate a cursor through the due-list so a list longer than `batch` is fully
  // swept over successive runs. The cursor is a plain offset; if the list shrank
  // below it we wrap to 0.
  let cursor = Number(await kv.get("coach:reconcile:cursor")) || 0;
  if (cursor >= ids.length) cursor = 0;
  const take = Math.min(batch, ids.length);
  const slice = [];
  for (let i = 0; i < take; i++) slice.push(ids[(cursor + i) % ids.length]);
  const nextCursor = ids.length ? (cursor + take) % ids.length : 0;

  const deletedIds = [];
  let errorCount = 0;
  for (const id of slice) {
    const verdict = await verifyContact(env, id);
    if (verdict === "deleted") deletedIds.push(id);
    else if (verdict === "error") errorCount++;
  }

  // Advance the cursor regardless of outcome — a transient-heavy run still made
  // progress through the list; the next run picks up where this one stopped.
  await kv.put("coach:reconcile:cursor", String(nextCursor));

  // Circuit breaker — refuse an implausible mass-deletion (systemic misfire).
  let skippedReason = null;
  if (deletedIds.length >= BREAKER_MIN && deletedIds.length >= BREAKER_FRACTION * slice.length) {
    skippedReason = `breaker: ${deletedIds.length}/${slice.length} of the batch returned 404 — treating as a systemic misfire, not a real purge; no keys touched. Investigate before re-running.`;
    console.error(`[reconcile] ${skippedReason}`);
    const summary = { ranAt: new Date(start).toISOString(), checked: slice.length, deletedCount: 0, errorCount, deletedIds: [], skippedReason, durationMs: Date.now() - start };
    await kv.put("ops:coach-reconcile:lastRun", JSON.stringify(summary));
    return summary;
  }

  if (deletedIds.length) {
    const deleted = new Set(deletedIds);

    // 1. Rewrite coach:due:latest without the ghosts (recount, stamp the reconcile).
    const keptDue = due.filter((d) => !deleted.has(d.contactId));
    const counts = {};
    for (const d of keptDue) counts[d.state] = (counts[d.state] || 0) + 1;
    await kv.put("coach:due:latest", JSON.stringify({
      ...dueDoc, due: keptDue, counts,
      reconciledAtISO: new Date(start).toISOString(),
      reconciledRemoved: deletedIds.length,
    }));

    // 2. Prune conv:index so deriveCadence never rebuilds the ghost next run.
    const index = (await kv.get("conv:index", "json")) || {};
    let indexChanged = false;
    for (const id of deletedIds) if (id in index) { delete index[id]; indexChanged = true; }
    if (indexChanged) await kv.put("conv:index", JSON.stringify(index));

    // 3. Purge the per-contact cache/coaching keys.
    for (const id of deletedIds) await purgeContact(kv, id);

    console.log(`[reconcile] purged ${deletedIds.length} deleted contact(s) from due-list + cache: ${deletedIds.join(", ")}`);
  }

  const summary = {
    ranAt: new Date(start).toISOString(),
    dueSize: ids.length,
    checked: slice.length,
    cursorFrom: cursor,
    cursorTo: nextCursor,
    deletedCount: deletedIds.length,
    deletedIds,
    errorCount,
    durationMs: Date.now() - start,
  };
  await kv.put("ops:coach-reconcile:lastRun", JSON.stringify(summary));
  return summary;
}
