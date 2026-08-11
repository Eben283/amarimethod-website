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
import { handleEvent } from "./engine.js";
import { runAutomationCycle } from "./automation-cycle.js";
import { reconcileDeliveryReceipts } from "./delivery-receipts.js";
import { handleWebhook } from "./webhook.js";
import { handleDashboardPage, handleDashboardData } from "./dashboard.js";
import { dashboardSessionCookie } from "./dashboard-session.js";
import { handleGhlEvent } from "./ghl-events.js";
import { runtimeStatus } from "./runtime-status.js";
import { INITIAL_IN_PERSON_WORKFLOW } from "./initial-in-person-workflow.js";
import { INITIAL_VIRTUAL_WORKFLOW } from "./initial-virtual-workflow.js";
import { ensurePublishedWorkflow, saveDraftWorkflow, publishDraftWorkflow, publishBundledWorkflow } from "./workflow-store.js";
import { appendEvent } from "./store.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
const DASHBOARD_ACCESS_TTL_SECONDS = 5 * 60;

function dashboardAccessCode() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function dashboardAccessKey(code) {
  return `automation-dashboard-access:${code}`;
}

function requestedStaffActor(value) {
  const actor = String(value || "").trim();
  return /^[A-Za-z][A-Za-z .'-]{0,78}$/.test(actor) ? actor : "Staff";
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomationCycle(env, Date.now()));
  },

  async fetch(request, env) {
    const url0 = new URL(request.url);
    const dashboardAccess = url0.pathname.match(/^\/dashboard-access\/([a-f0-9]{48})$/);
    if (request.method === "GET" && dashboardAccess) {
      const key = dashboardAccessKey(dashboardAccess[1]);
      const access = await env.PORTAL_KV?.get(key, "json");
      if (!access) return new Response("Dashboard access link expired. Generate a new one from Staff.", { status: 410 });
      await env.PORTAL_KV.delete(key);
      const cookie = await dashboardSessionCookie(env, access.actor || "Staff");
      if (!cookie) return new Response("Dashboard session is not configured.", { status: 503 });
      const embed = url0.searchParams.get("embed") === "1" ? "?embed=1" : "";
      return new Response(null, {
        status: 302,
        headers: { Location: `/dashboard${embed}`, "Set-Cookie": cookie, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    }
    // The watch dashboard: a public shell (no data) + a data route gated by its own
    // read-only DASHBOARD_KEY — not the worker bearer (that secret gates GHL-write routes
    // elsewhere and doesn't belong in a browser).
    if (request.method === "GET" && url0.pathname === "/dashboard") {
      return handleDashboardPage();
    }
    if (request.method === "GET" && url0.pathname === "/dashboard-data") {
      return handleDashboardData(request, env);
    }

    // GHL field/order events (order, sessions_completed, sessions_remaining) — X-Webhook-Secret.
    if (request.method === "POST" && url0.pathname === "/ghl-event") {
      try {
        return await handleGhlEvent(request, env, Date.now());
      } catch (err) {
        return json(500, { error: String((err && err.message) || err) });
      }
    }

    // GHL appointment ingest — its own auth scheme (X-Webhook-Secret, checked inside),
    // NOT the bearer gate: GHL webhook actions can't send Authorization headers.
    if (request.method === "POST" && url0.pathname === "/webhook") {
      try {
        return await handleWebhook(request, env, Date.now());
      } catch (err) {
        return json(500, { error: String((err && err.message) || err) });
      }
    }

    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/dashboard-access-link") {
        if (!env.PORTAL_KV) return json(503, { error: "dashboard access storage is not configured" });
        const code = dashboardAccessCode();
        await env.PORTAL_KV.put(
          dashboardAccessKey(code),
          JSON.stringify({ actor: requestedStaffActor(request.headers.get("X-Staff-Actor")) }),
          { expirationTtl: DASHBOARD_ACCESS_TTL_SECONDS },
        );
        return json(200, {
          success: true,
          expiresInSeconds: DASHBOARD_ACCESS_TTL_SECONDS,
          url: `${url.origin}/dashboard-access/${code}`,
        }, { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      }
      if (request.method === "POST" && url.pathname === "/event") {
        const event = await request.json();
        const { actions } = await handleEvent(env, event, Date.now());
        return json(200, { success: true, actions });
      }
      if (request.method === "POST" && url.pathname === "/run") {
        const cycle = await runAutomationCycle(env, Date.now());
        return json(200, { success: true, ...cycle });
      }
      if (request.method === "POST" && url.pathname === "/receipts/run") {
        const receipts = await reconcileDeliveryReceipts(env, Date.now());
        return json(200, { success: true, receipts });
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return json(200, { success: true, worker: "reminder-engine", now: Date.now() });
      }
      if (request.method === "GET" && url.pathname === "/runtime-status") {
        const flowKey = String(url.searchParams.get("flow") || "").trim();
        const runtime = await runtimeStatus(env, flowKey);
        if (!runtime) return json(404, { error: "unknown flow" });
        return json(200, { success: true, runtime });
      }
      if (request.method === "POST" && url.pathname === "/workflow-release") {
        const body = await request.json();
        if (body?.workflowId !== INITIAL_VIRTUAL_WORKFLOW.id) return json(400, { error: "unsupported workflow release" });
        if (env.INITIAL_VIRTUAL_BEHAVIOR_RELEASE !== "approved") {
          return json(403, { error: "Initial Virtual behavior release is not approved" });
        }
        const document = await publishBundledWorkflow(env.REMINDER_DB, INITIAL_VIRTUAL_WORKFLOW);
        await appendEvent(env.REMINDER_DB, {
          ts: Date.now(), engine: "reminder", flowKey: document.id, definitionVersion: document.version,
          action: "workflow_published", outcome: "published", detail: { actor: requestedStaffActor(request.headers.get("X-Staff-Actor")), lane: "initial_virtual_behavior_release" },
        });
        return json(200, { success: true, document });
      }
      if (request.method === "POST" && url.pathname === "/workflow-draft") {
        const body = await request.json();
        const current = await ensurePublishedWorkflow(env.REMINDER_DB, INITIAL_IN_PERSON_WORKFLOW);
        if (body?.document?.id !== current.id || body.document.version !== current.version + 1) {
          return json(409, { error: `draft must be ${current.id} v${current.version + 1}` });
        }
        const document = await saveDraftWorkflow(env.REMINDER_DB, body.document);
        return json(200, { success: true, document, publishedVersion: current.version });
      }
      if (request.method === "POST" && url.pathname === "/workflow-publish") {
        const body = await request.json();
        if (body?.workflowId !== INITIAL_IN_PERSON_WORKFLOW.id || !Number.isInteger(body?.version) || !Number.isInteger(body?.expectedPublishedVersion)) {
          return json(400, { error: "workflowId, version, and expectedPublishedVersion are required" });
        }
        const document = await publishDraftWorkflow(env.REMINDER_DB, body.workflowId, body.version, body.expectedPublishedVersion);
        await appendEvent(env.REMINDER_DB, {
          ts: Date.now(), engine: "reminder", flowKey: document.id, definitionVersion: document.version,
          action: "workflow_published", outcome: "published", detail: { actor: requestedStaffActor(request.headers.get("X-Staff-Actor")) },
        });
        return json(200, { success: true, document });
      }
      return json(404, { error: "not found" });
    } catch (err) {
      return json(500, { error: String((err && err.message) || err) });
    }
  },
};
