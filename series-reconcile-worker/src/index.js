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

import { listRecentCompletedOrders, getOrderDetail } from "./ghl.js";
import { reconcileOrder } from "./reconcile.js";

const KV_LAST_RUN_KEY = "ops:series-reconcile:lastRun";
const DEFAULT_LOOKBACK_HOURS = 24;
const SLEEP_MS = 100;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReconcile(env, "cron", DEFAULT_LOOKBACK_HOURS));
  },

  async fetch(request, env) {
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
      const days = clampInt(url.searchParams.get("days"), 1, 180, 30);
      const result = await runReconcile(env, "backfill", days * 24);
      return jsonResponse(result);
    }

    return jsonResponse({
      worker: "series-reconcile",
      endpoints: ["/status", "/run?hours=N", "/backfill?days=N"],
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

async function runReconcile(env, trigger, lookbackHours) {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const sinceMs = startMs - lookbackHours * 3600 * 1000;
  console.log(`[series-reconcile] starting trigger=${trigger} lookbackHours=${lookbackHours}`);

  const results = {
    applied: [],
    skipped: { alreadyProcessed: 0, alreadyApplied: 0, notPackage: 0, notPaid: 0, noContact: 0 },
    errored: [],
  };

  try {
    const orders = await listRecentCompletedOrders(env, sinceMs);
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

    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      status: results.errored.length > 0 ? "partial-errors" : "ok",
      lookbackHours,
      ordersScanned: orders.length,
      applied: results.applied.length,
      appliedDetail: results.applied,
      skipped: results.skipped,
      errored: results.errored,
      failed: results.errored.length,
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
