// Series Reconcile Worker
// Hourly cron — catches orphan paid package purchases (POS / invoice /
// payment_link orders that didn't trigger their C-series workflow). Applies
// the same field set the workflow would have applied. Idempotent via
// PURCHASE_KV (shared namespace with functions/api/ghl-purchase-webhook.js
// so the two systems can't double-apply on the same order).
//
// WHY THIS EXISTS:
// The GHL "Order Submitted" workflow trigger that drives C1/C2/C1b/C2b/Cnew
// has historically failed to fire reliably for POS-source orders (and some
// payment_link orders). Documented in 2026-03-05 Zach Taylor + 2026-04-10
// Danny Blumrich + 2026-05-28 Justin Grinius / Jenn Kadri incidents. This
// Worker is the catch-all backstop — runs every hour, finds any paid order
// where the contact's fields don't match what the workflow should have set,
// and applies the missing updates.
//
// STATE IN KV:
//   PORTAL_KV   ops:series-reconcile:lastRun  — last run summary
//   PURCHASE_KV processed:<orderId>            — idempotency record (90d TTL)
//
// ENDPOINTS:
//   /          — info
//   /status    — last run summary (JSON)
//   /run       — on-demand run with default 24h window
//   /backfill?days=N — wider lookback (manual recovery of historical orphans)

import { listRecentCompletedOrders, getOrderDetail, fetchActiveSeriesContactIds } from "./ghl.js";
import { reconcileOrder } from "./reconcile.js";
import { getContactCounts, syncContacts, syncFieldsForContact } from "./sync.js";
import { nextChunk, isQueueStale, requeueAfterSweep } from "./queue.js";
import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";

// Field-sync sweep chunk per run. ~5 subrequests per contact (4 fetches + 1 PUT).
// Kept small to stay under the 50-subrequest free-tier cap alongside the order
// pass: 8 × 5 = 40 + orders ~5-10. Over-budget contacts just error and are
// re-swept next cycle (each syncFieldsForContact has its own try/catch).
const SYNC_SWEEP_CHUNK = 8;

const KV_LAST_RUN_KEY = "ops:series-reconcile:lastRun";
// Active-series field-sync sweep queue (the mid-package drift fix). Rebuilt ~daily.
const KV_QUEUE_KEY = "field-sync:queue";
const KV_QUEUE_GENERATED_KEY = "field-sync:queueGeneratedAt";
const QUEUE_TTL_MS = 22 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = 24;
const SLEEP_MS = 100;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReconcile(env, "cron", DEFAULT_LOOKBACK_HOURS));
  },

  async fetch(request, env) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    if (url.pathname === "/status") {
      const data = await env.PORTAL_KV.get(KV_LAST_RUN_KEY, "json");
      if (!data) return jsonResponse({ error: "Never run" }, 404);
      return jsonResponse(data);
    }

    if (url.pathname === "/run") {
      const hours = clampInt(url.searchParams.get("hours"), 1, 168, DEFAULT_LOOKBACK_HOURS);
      const result = await runReconcile(env, "manual", hours);
      return jsonResponse(result);
    }

    if (url.pathname === "/backfill") {
      // Cap at 90 days: the PURCHASE_KV idempotency record TTL is 90 * 86400
      // (reconcile.js). Backfilling past that window means KV no longer
      // remembers an order was processed, so the only thing stopping a re-apply
      // is the field-state check (isReconcileAlreadyApplied) — which fails if
      // any field was legitimately changed since (package finished, portal
      // revoked), resetting sessions_remaining to full + re-granting access.
      // Keeping days <= TTL means KV idempotency always covers the backfill
      // window (CRIT-C, 2026-06-11 review).
      const days = clampInt(url.searchParams.get("days"), 1, 90, 30);
      const result = await runReconcile(env, "backfill", days * 24);
      return jsonResponse(result);
    }

    // Field sync for one specific contact. Useful for testing + ad-hoc fixes.
    // GET /sync?contactId=sipSPSq3CIOOfzyJxVJ3
    if (url.pathname === "/sync") {
      const contactId = url.searchParams.get("contactId");
      if (!contactId) return jsonResponse({ error: "contactId param required" }, 400);
      const result = await syncFieldsForContact(env, contactId, {});
      return jsonResponse(result);
    }

    // Read-only ledger-derived counts for one or more contacts. Used by
    // /day morning briefing to get authoritative session counts in one
    // hop, so the skill doesn't have to interpret raw GHL fields.
    // GET  /contact-counts?contactId=X            — single contact
    // GET  /contact-counts?contactIds=A,B,C       — batch (comma-separated)
    if (url.pathname === "/contact-counts") {
      const single = url.searchParams.get("contactId");
      const batch = url.searchParams.get("contactIds");
      const ids = single ? [single] : (batch ? batch.split(",").map((s) => s.trim()).filter(Boolean) : []);
      if (ids.length === 0) return jsonResponse({ error: "contactId or contactIds param required" }, 400);
      if (ids.length > 20) return jsonResponse({ error: "max 20 contacts per request" }, 400);
      // Chunked: each getContactCounts fans out 4 GHL calls + hydration —
      // 20 unbounded was the 2026-06-03 staff-balances connection-cap
      // incident pattern (errors degraded gracefully, but chunking avoids
      // the failure entirely).
      const results = [];
      const COUNTS_CHUNK = 3;
      for (let i = 0; i < ids.length; i += COUNTS_CHUNK) {
        const part = await Promise.all(ids.slice(i, i + COUNTS_CHUNK).map((id) => getContactCounts(env, id, {})));
        results.push(...part);
      }
      return jsonResponse(single ? results[0] : { count: results.length, results });
    }

    // List contacts whose drift is too large to auto-correct (delta > 2 on
    // either field). The /day briefing's qa-audit can surface these as a
    // "needs Garrett review" section.
    if (url.pathname === "/needs-review") {
      const list = await env.PORTAL_KV.list({ prefix: "field-sync:needsReview:" });
      const items = await Promise.all(
        list.keys.map(async (k) => env.PORTAL_KV.get(k.name, "json"))
      );
      return jsonResponse({ count: items.length, items: items.filter(Boolean) });
    }

    return jsonResponse({
      worker: "series-reconcile",
      endpoints: ["/status", "/run?hours=N", "/backfill?days=N", "/sync?contactId=X", "/contact-counts?contactId=X|contactIds=A,B,C", "/needs-review"],
    });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clampInt(raw, min, max, def) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Get the active-series sweep queue, rebuilding from GHL when stale/empty.
async function getOrBuildSyncQueue(env) {
  const generatedAt = await env.PORTAL_KV.get(KV_QUEUE_GENERATED_KEY);
  const queue = await env.PORTAL_KV.get(KV_QUEUE_KEY, "json");
  if (!isQueueStale(queue, generatedAt, Date.now(), QUEUE_TTL_MS)) {
    return { queue, rebuilt: false };
  }
  const ids = await fetchActiveSeriesContactIds(env);
  await env.PORTAL_KV.put(KV_QUEUE_KEY, JSON.stringify(ids));
  await env.PORTAL_KV.put(KV_QUEUE_GENERATED_KEY, String(Date.now()));
  console.log(`[series-reconcile] sync queue rebuilt: ${ids.length} active-series contacts`);
  return { queue: ids, rebuilt: true };
}

async function runReconcile(env, trigger, lookbackHours) {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const sinceMs = startMs - lookbackHours * 3600 * 1000;
  console.log(`[series-reconcile] starting trigger=${trigger} lookbackHours=${lookbackHours}`);

  const results = {
    applied: [],
    skipped: { alreadyProcessed: 0, alreadyApplied: 0, notPackage: 0, notPaid: 0, noContact: 0, locked: 0 },
    errored: [],
  };

  try {
    // Scope the order pass: a flaky orders-LIST fetch (or any throw before the
    // per-order try) must NOT skip the field-sync sweep below — that's an
    // independent data path (the active-series contact queue, not the orders
    // window). Record the failure and fall through to the sweep.
    let orders = [];
    let orderPassError = null;
    try {
      orders = await listRecentCompletedOrders(env, sinceMs);
      console.log(`[series-reconcile] fetched ${orders.length} completed orders in window`);

      for (const o of orders) {
        try {
          const detail = await getOrderDetail(env, o._id);
          const r = await reconcileOrder(env, detail);
          switch (r.status) {
            case "applied":
              results.applied.push(r);
              console.log(`[series-reconcile] APPLIED ${r.package} for ${r.contactName} (${r.contactId}), order=${r.orderId}`);
              break;
            case "skip-already-processed":
              results.skipped.alreadyProcessed += 1;
              break;
            case "skip-already-applied":
              results.skipped.alreadyApplied += 1;
              break;
            case "skip-not-package":
              results.skipped.notPackage += 1;
              break;
            case "skip-not-paid":
              results.skipped.notPaid += 1;
              break;
            case "skip-no-contact":
              results.skipped.noContact += 1;
              break;
            case "skip-locked":
              results.skipped.locked += 1;
              console.log(`[series-reconcile] SKIP-LOCKED ${r.package} for ${r.contactName} (${r.contactId}) — sessions_remaining_locked, order=${r.orderId}`);
              break;
            case "errored":
              results.errored.push(r);
              break;
          }
        } catch (err) {
          const msg = String(err.message || err).slice(0, 300);
          console.error(`[series-reconcile] order ${o._id} failed: ${msg}`);
          results.errored.push({ orderId: o._id, error: msg });
        }
        await sleep(SLEEP_MS);
      }
    } catch (err) {
      orderPassError = String(err.message || err).slice(0, 300);
      console.error(`[series-reconcile] order pass failed (field-sync sweep still runs): ${orderPassError}`);
    }

    // ── Active-series field-sync sweep (mid-package drift fix) ──
    // The OLD sync only touched contacts who placed an order in the lookback
    // window, so a mid-package client who buys once and draws down over weeks
    // (no new orders) was never re-synced and drifted permanently — Danny's
    // case. Instead, keep a KV queue of EVERY active-series contact and sync a
    // chunk each run, cycling through all of them and rebuilding ~daily.
    // Mirrors the partner-activity-refresh chunk-queue pattern. Per-contact
    // guards in sync.js still apply (high-confidence only, manual-lock,
    // MAX_AUTO_DELTA → needs-review, never decrement lifetime).
    let syncSummary = null;
    try {
      const { queue, rebuilt } = await getOrBuildSyncQueue(env);
      if (rebuilt) {
        // The rebuild spent the enumeration subrequest budget this run; start
        // syncing chunks next run to stay under the free-tier cap.
        syncSummary = { queueRebuilt: true, queueRemaining: queue.length, contactsScanned: 0 };
        console.log(`[series-reconcile] field-sync: queue rebuilt (${queue.length}), sync resumes next run`);
      } else {
        const { chunk, remaining } = nextChunk(queue, SYNC_SWEEP_CHUNK);
        const r = await syncContacts(env, chunk, {}, { maxPerRun: SYNC_SWEEP_CHUNK });
        // Re-queue contacts that errored this run (transient GHL failures) to the
        // back so they're retried, not dropped until the next ~daily rebuild.
        const erroredIds = r.results.filter((x) => x.status === "errored").map((x) => x.contactId);
        const newQueue = requeueAfterSweep(chunk, chunk.length, remaining, erroredIds);
        await env.PORTAL_KV.put(KV_QUEUE_KEY, JSON.stringify(newQueue));
        const synced = r.results.filter((x) => x.status === "synced");
        syncSummary = { ...r, queueRemaining: newQueue.length, requeuedErrored: erroredIds.length, queueRebuilt: false };
        console.log(
          `[series-reconcile] field-sync sweep: chunk of ${chunk.length} (${synced.length} written, ${erroredIds.length} re-queued), ${newQueue.length} left in queue`
        );
      }
    } catch (syncErr) {
      console.error("[series-reconcile] field-sync sweep failed:", syncErr);
      syncSummary = { error: String(syncErr.message || syncErr).slice(0, 300) };
    }

    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      // syncSummary.error too: a fully-failed field-sync sweep (KV outage,
      // contacts/search 401) used to hide inside the nested object while the
      // headline stayed green "ok" indefinitely.
      status: (orderPassError || results.errored.length > 0 || syncSummary?.error) ? "partial-errors" : "ok",
      lookbackHours,
      ordersScanned: orders.length,
      orderPassError,
      applied: results.applied.length,
      appliedDetail: results.applied,
      skipped: results.skipped,
      errored: results.errored,
      failed: results.errored.length,
      fieldSync: syncSummary,
    };

    await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    console.log(
      `[series-reconcile] done: applied=${summary.applied} scanned=${summary.ordersScanned} errored=${summary.failed} duration=${summary.durationMs}ms`
    );
    return summary;
  } catch (err) {
    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      status: "error",
      error: String(err.message || err).slice(0, 500),
      lookbackHours,
      applied: results.applied.length,
      appliedDetail: results.applied,
      skipped: results.skipped,
      errored: results.errored,
      failed: results.errored.length,
    };
    try { await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary)); } catch {}
    console.error(`[series-reconcile] FAILED: ${summary.error}`);
    return summary;
  }
}
