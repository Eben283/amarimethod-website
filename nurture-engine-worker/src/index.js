// Nurture engine worker — entry point.
//   scheduled() : the cron sweep (fires or shadow-logs every due step)
//   fetch()     : authenticated HTTP surface
//     POST /event  { ...appointment event | kinded quiz/purchase/tag event }  → enroll/exit
//     POST /run                                                               → sweep now (ops)
//     GET  /status                                                            → liveness
//
// Emitters post typed events to /event rather than importing engine code — same decoupling as
// the reminder engine: the Pages appointment webhook (via appointment-dispatch.js), the quiz
// endpoint (send-to-ghl.js → quiz.submitted), the purchase webhook path, and the GHL→code tag
// bridge all land here.
//
// Secrets/bindings (wrangler.toml): NURTURE_DB (D1), WORKER_AUTH_SECRET (fetch gate). Active
// mode additionally needs GHL token access for the send adapter, contact reads (branch steps),
// and onEnter tag writes; shadow mode — the default — touches none of them.

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
        let event;
        try {
          event = await request.json();
        } catch {
          return json(400, { error: "invalid JSON" });
        }
        const { actions } = await handleEvent(env, event, Date.now());
        return json(200, { success: true, actions });
      }
      if (request.method === "POST" && url.pathname === "/run") {
        const counts = await runSweep(env, Date.now());
        return json(200, { success: true, counts });
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return json(200, { success: true, worker: "nurture-engine", now: Date.now() });
      }
      return json(404, { error: "not found" });
    } catch (err) {
      return json(500, { error: String((err && err.message) || err) });
    }
  },
};
