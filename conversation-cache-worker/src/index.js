// Conversation Cache Worker
// Maintains an incremental cache of GHL conversation history in KV so downstream
// consumers (the outreach coach's cadence step, learning, etc.) read the cache
// instead of each re-pulling 60 days of conversations from GHL every day.
//
// "Pull once, then only what changed." First run backfills ~90 days; every run
// after pulls only conversations whose last_message_date moved past the
// high-water mark (conv:sync:lastRun), with a 30-min overlap for safety.
//
// Routes (gated by WORKER_AUTH_SECRET):
//   /sync                 — run the incremental sync now (awaited), return summary
//   /status               — last-run summary
//   /conversations?contactId=  — read one contact's cached touch history
//   /index                — the roster { contactId: lastMessageDate }
//
// Cron: every 3 hours (see wrangler.toml).

import { runSync } from "./sync.js";
import { deriveCadence } from "./cadence.js";
import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";

export default {
  async scheduled(event, env, ctx) {
    // The Monday weekly cron does a FULL reconcile (drift insurance); the 3-hourly
    // cron does the cheap incremental sync. Both then derive the due-list.
    const full = event.cron === "0 9 * * 1";
    ctx.waitUntil(runSync(env, full ? "cron-full" : "cron", full).then(() => deriveCadence(env)));
  },

  async fetch(request, env, ctx) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    if (url.pathname === "/sync" || url.pathname === "/__scheduled") {
      // Awaited inline (not ctx.waitUntil): the message fetches are I/O-bound and
      // can run tens of seconds; the caller waits for the summary.
      // ?full=1 forces a full reconcile (re-scan the whole window).
      const full = url.searchParams.get("full") === "1";
      const sync = await runSync(env, full ? "manual-full" : "manual", full);
      const cadence = await deriveCadence(env);
      return json({ sync, cadence });
    }

    if (url.pathname === "/cadence") {
      // Re-derive the due-list from the existing cache (no GHL conversation pull).
      const cadence = await deriveCadence(env);
      return json(cadence);
    }

    if (url.pathname === "/due") {
      const data = await env.PORTAL_KV.get("coach:due:latest", "json");
      return data ? json(data) : json({ error: "Never derived" }, 404);
    }

    if (url.pathname === "/status") {
      const data = await env.PORTAL_KV.get("ops:conversation-cache:lastRun", "json");
      return data ? json(data) : json({ error: "Never run" }, 404);
    }

    if (url.pathname === "/conversations") {
      const id = url.searchParams.get("contactId");
      if (!id) return json({ error: "contactId required" }, 400);
      const data = await env.PORTAL_KV.get(`conv:${id}`, "json");
      return data ? json(data) : json({ contactId: id, cached: null }, 404);
    }

    if (url.pathname === "/index") {
      const data = (await env.PORTAL_KV.get("conv:index", "json")) || {};
      return json({ count: Object.keys(data).length, index: data });
    }

    return new Response("Not found. Use /sync, /status, /conversations?contactId=, or /index.", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
