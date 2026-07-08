// Funnel Refresh Worker
// Regenerates the Amari staff funnel snapshot in the cloud (previously only
// produced on Eben's Mac by ~/.claude/ghl-mcp/funnel.mjs + a LaunchAgent).
//
// The full pull is ~400 GHL subrequests (contacts + conversations + per-conversation
// messages + gifted calendar events + payment transactions/invoices/orders). That
// fits in ONE paid-tier Worker invocation (1000-subrequest budget), so unlike the
// partner-activity-refresh worker there is no chunking — one run produces the whole
// snapshot.
//
// LIVE (cutover 2026-06-12): scheduled + manual runs write the live key
// (funnel:latest) that the dashboard reads. Hourly cron.
//
// State in KV:
//   funnel:latest                     — the snapshot the dashboard reads
//   ops:funnel-refresh:lastRun        — last-run summary (for UI freshness / observability)
//   funnel:targets                    — frozen monthly per-stage targets (replaces local funnel-targets.json)

import { buildFunnelSnapshot } from "./funnel.js";
import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import { writeBeat } from "../../functions/lib/heartbeat.js";

// LIVE — cutover 2026-06-12. Writes the snapshot the dashboard actually reads.
const KV_SNAPSHOT_KEY = "funnel:latest";
const KV_LAST_RUN_KEY = "ops:funnel-refresh:lastRun";

// Match `node funnel.mjs 180`.
const WINDOW_DAYS = 180;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env, "cron"));
  },

  async fetch(request, env, ctx) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    if (url.pathname === "/refresh" || url.pathname === "/__scheduled") {
      // Run the pull INLINE (awaited before responding) rather than in
      // ctx.waitUntil(). The full pull (~317 per-conversation message fetches)
      // takes ~30s of WALL time — almost all of it idle, waiting on GHL I/O
      // (CPU is <300ms). ctx.waitUntil() tasks are cancelled ~30s AFTER the
      // response returns, which killed the pull mid-flight; an awaited fetch
      // handler gets the full request duration. The caller waits for the
      // summary. (At cutover, the cron path uses scheduled() below, which has
      // its own generous budget and does NOT depend on this.)
      const result = await runRefresh(env, "manual");
      return jsonResponse(result);
    }

    if (url.pathname === "/status") {
      const data = await env.PORTAL_KV.get(KV_LAST_RUN_KEY, "json");
      if (!data) return jsonResponse({ error: "Never run" }, 404);
      return jsonResponse(data);
    }

    return new Response("Not found. Use /refresh or /status.", { status: 404 });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runRefresh(env, trigger) {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  console.log(`[funnel-refresh] starting (trigger=${trigger}, window=${WINDOW_DAYS}d)`);

  try {
    const snapshot = await buildFunnelSnapshot(env, WINDOW_DAYS);
    const json = JSON.stringify(snapshot);

    // Write the live snapshot key (funnel:latest) — the dashboard reads this.
    await env.PORTAL_KV.put(KV_SNAPSHOT_KEY, json);

    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      status: "ok",
      snapshotKey: KV_SNAPSHOT_KEY,
      windowDays: WINDOW_DAYS,
      bytes: json.length,
      calls: snapshot.calls.length,
      sessions: snapshot.sessions.length,
      sales: snapshot.sales.length,
      sessionsSold: snapshot.sales.reduce((t, s) => t + s.s, 0),
      paceLine: snapshot.paceLine,
    };
    await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    // Heartbeat: producedN = total snapshot rows. 0 rows = a broken pull (an
    // active practice always has calls/sessions/sales), so it flags red in /day.
    try {
      await writeBeat(env.PORTAL_KV, "funnel-refresh", {
        producedN: summary.calls + summary.sessions + summary.sales,
        ok: true,
      });
    } catch (beatErr) {
      console.error("[funnel-refresh] beat write failed (non-fatal):", beatErr);
    }
    console.log(`[funnel-refresh] done: ${summary.calls} calls, ${summary.sessions} sessions, ${summary.sales} sales (${summary.sessionsSold} sold), ${summary.bytes}b, ${summary.durationMs}ms`);
    return summary;
  } catch (e) {
    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      status: "error",
      error: String(e.message || e).slice(0, 500),
    };
    try {
      await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    } catch (kvErr) {
      console.error("[funnel-refresh] failed to write summary to KV:", kvErr);
    }
    // Heartbeat: mark the run failed so /day flags it red instead of showing a
    // stale-but-green last good run.
    try {
      await writeBeat(env.PORTAL_KV, "funnel-refresh", { producedN: 0, ok: false });
    } catch (beatErr) {
      console.error("[funnel-refresh] beat write failed (non-fatal):", beatErr);
    }
    console.error("[funnel-refresh] FAILED:", summary.error);
    return summary;
  }
}
