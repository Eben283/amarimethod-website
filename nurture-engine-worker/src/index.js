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
// Secrets/bindings (wrangler.toml): NURTURE_DB (D1), CRM_DB (owned people/tags/attributes),
// WORKER_AUTH_SECRET (fetch gate). Shadow mode is the default and never sends.

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import { handleEvent, runSweep } from "./engine.js";
import { handleTagWebhook } from "./tag-bridge.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSweep(env, Date.now()));
  },

  async fetch(request, env) {
    const url0 = new URL(request.url);
    // GHL tag bridge — its own auth scheme (X-Webhook-Secret, checked inside), not the
    // bearer gate: GHL webhook actions can't send Authorization headers.
    if (request.method === "POST" && url0.pathname === "/tag-webhook") {
      try {
        return await handleTagWebhook(request, env, Date.now());
      } catch (err) {
        return json(500, { error: String((err && err.message) || err) });
      }
    }

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
        // Direct owned events must resolve guard state through CRM_DB. The separate legacy
        // /tag-webhook remains a bounded transition adapter, but it cannot override this path.
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
