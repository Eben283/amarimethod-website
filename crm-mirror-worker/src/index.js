import { requireWorkerAuth, workerAuthActive } from "../../functions/lib/worker-auth.js";
import { dashboardHtml } from "./dashboard.js";
import { dashboardSessionCookie, hasDashboardSession, hasReviewSession, reviewSessionCookie } from "./dashboard-session.js";
import {
  activeClientOperations,
  classifyPurchase,
  decideReconciliationCandidate,
  mirrorStatus,
  reconciliationQueue,
  reconciliationReview,
  reconciliationStatus,
} from "./repository.js";
import { syncRequestedProviders } from "./sync.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const DEFAULT_SOURCES = ["ghl", "stripe"];

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function parseSyncRequest(payload) {
  const requested = Array.isArray(payload?.sources) ? payload.sources : DEFAULT_SOURCES;
  const sources = [...new Set(requested.filter((source) => source === "ghl" || source === "stripe"))];
  if (!sources.length) throw new Error("sources must contain ghl and/or stripe");
  const requestedLimit = Number(payload?.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 25;
  return { sources, limit };
}

export function parseQueueLimit(value) {
  if (value == null || value === "") return 25;
  const requestedLimit = Number(value);
  return Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 25;
}

async function requireDashboardReadAuth(request, env) {
  const bearerDenied = requireWorkerAuth(request, env);
  if (!bearerDenied || await hasDashboardSession(request, env)) return null;
  return bearerDenied;
}

async function requireReviewWriteAuth(request, env) {
  const bearerDenied = requireWorkerAuth(request, env);
  if (!bearerDenied || await hasReviewSession(request, env)) return null;
  return bearerDenied;
}

async function actionPayload(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 4096) throw new Error("request body too large");
  try {
    return await request.json();
  } catch {
    throw new Error("invalid JSON");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // The shell has no data or action controls. Data endpoints remain protected,
    // and the fragment-held access token is stripped from browser history.
    if (request.method === "GET" && url.pathname === "/") return html(dashboardHtml());

    try {
      if (request.method === "POST" && url.pathname === "/dashboard-session") {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
        const cookie = await dashboardSessionCookie(env);
        return json(200, { success: true, expiresInSeconds: 8 * 60 * 60 }, { "Set-Cookie": cookie });
      }
      if (request.method === "POST" && url.pathname === "/review-session") {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
        const cookie = await reviewSessionCookie(env);
        return json(200, { success: true, expiresInSeconds: 15 * 60 }, { "Set-Cookie": cookie });
      }
      if (request.method === "GET" && url.pathname === "/review-session") {
        const denied = await requireDashboardReadAuth(request, env);
        if (denied) return denied;
        return json(200, { success: true, active: await hasReviewSession(request, env) });
      }
      const candidateDecision = url.pathname.match(/^\/reconciliation\/candidates\/([^/]+)\/decision$/);
      if (request.method === "POST" && candidateDecision) {
        const denied = await requireReviewWriteAuth(request, env);
        if (denied) return denied;
        const payload = await actionPayload(request);
        const result = await decideReconciliationCandidate(
          env.CRM_DB,
          decodeURIComponent(candidateDecision[1]),
          payload.decision,
          payload.reviewedBy,
          new Date().toISOString(),
        );
        return json(200, { success: true, result });
      }
      const purchaseClassification = url.pathname.match(/^\/purchases\/([^/]+)\/classification$/);
      if (request.method === "POST" && purchaseClassification) {
        const denied = await requireReviewWriteAuth(request, env);
        if (denied) return denied;
        const payload = await actionPayload(request);
        const result = await classifyPurchase(
          env.CRM_DB,
          decodeURIComponent(purchaseClassification[1]),
          payload.resolution,
          payload.packageId || null,
          payload.reviewedBy,
          new Date().toISOString(),
        );
        return json(200, { success: true, result });
      }
      if (request.method === "GET" && ["/status", "/operations", "/reconciliation", "/reconciliation/queue", "/reconciliation/review"].includes(url.pathname)) {
        const denied = await requireDashboardReadAuth(request, env);
        if (denied) return denied;
      } else {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return json(200, { success: true, worker: "amari-crm-mirror", authActive: workerAuthActive(env), ...(await mirrorStatus(env.CRM_DB)) });
      }
      if (request.method === "GET" && url.pathname === "/operations") {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await activeClientOperations(env.CRM_DB, limit, new Date().toISOString())),
        });
      }
      if (request.method === "GET" && url.pathname === "/reconciliation") {
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await reconciliationStatus(env.CRM_DB)),
        });
      }
      if (request.method === "GET" && url.pathname === "/reconciliation/queue") {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          candidates: await reconciliationQueue(env.CRM_DB, limit),
        });
      }
      if (request.method === "GET" && url.pathname === "/reconciliation/review") {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await reconciliationReview(env.CRM_DB, limit)),
        });
      }
      if (request.method === "POST" && url.pathname === "/sync") {
        const length = Number(request.headers.get("Content-Length") || 0);
        if (length > 4096) return json(413, { error: "request body too large" });
        let payload = {};
        try {
          payload = await request.json();
        } catch {
          return json(400, { error: "invalid JSON" });
        }
        const { sources, limit } = parseSyncRequest(payload);
        const results = await syncRequestedProviders(env, sources, limit, new Date().toISOString());
        console.log(JSON.stringify({ event: "crm_mirror_sync", sources, limit, results }));
        return json(200, { success: true, sources, limit, results });
      }
      return json(404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "crm_mirror_error", path: url.pathname, message }));
      return json(500, { error: "CRM mirror request failed" });
    }
  },
};

export { parseSyncRequest };
