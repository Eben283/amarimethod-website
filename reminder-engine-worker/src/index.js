// Reminder engine worker — entry point.
//   scheduled() : the cron sweep (fires or shadow-logs every due step)
//   fetch()     : authenticated HTTP surface
//     POST /event  { ...typed appointment event }  → enroll/cancel (called by the webhook dispatch)
//     POST /run                                     → run a sweep now (manual/ops)
//     GET  /status                                  → liveness
//
// The Pages webhook (functions/api/appointment-webhook.js → appointment-dispatch.js) posts the typed
// event to /event rather than importing engine code — clean decoupling, no cross-bundle import.
//
// Secrets/bindings (wrangler.toml): REMINDER_DB (D1), WORKER_AUTH_SECRET (fetch gate). Active mode
// additionally needs GHL token access (PORTAL_KV + GHL_CLIENT_ID/SECRET) for the send adapter;
// shadow mode — the default — touches neither.

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import { handleEvent, runSweep } from "./engine.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSweep(env, Date.now()));
  },

  async fetch(request, env) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/event") {
        const event = await request.json();
        const { actions } = await handleEvent(env, event, Date.now());
        return json(200, { success: true, actions });
      }
      if (request.method === "POST" && url.pathname === "/run") {
        const counts = await runSweep(env, Date.now());
        return json(200, { success: true, counts });
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return json(200, { success: true, worker: "reminder-engine", now: Date.now() });
      }
      return json(404, { error: "not found" });
    } catch (err) {
      return json(500, { error: String((err && err.message) || err) });
    }
  },
};
