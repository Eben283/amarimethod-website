import { requireWorkerAuth, workerAuthActive } from "../../functions/lib/worker-auth.js";
import { dashboardHtml } from "./dashboard.js";
import { clientDeskHtml } from "./client-desk.js";
import { dashboardSessionCookie, hasDashboardSession, hasReviewSession, reviewSessionCookie } from "./dashboard-session.js";
import {
  activeClientOperations,
  classifyPurchase,
  clientDeskContacts,
  contactProfile,
  decideLedgerCutoverCandidate,
  decideReconciliationCandidate,
  mirrorStatus,
  ledgerCutoverReview,
  reconciliationQueue,
  reconciliationReview,
  reconciliationStatus,
  searchContacts,
} from "./repository.js";
import { runScheduledSync, syncRequestedProviders } from "./sync.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const DEFAULT_SOURCES = ["ghl", "stripe"];
const DASHBOARD_ACCESS_TTL_SECONDS = 5 * 60;
const DASHBOARD_ACCESS_WORDS = Object.freeze([
  "aloe", "amber", "apricot", "arc", "ash", "bay", "birch", "bloom", "brook", "cedar", "clay", "cove", "dawn", "dune", "elm", "fern",
  "field", "flint", "glen", "gold", "grove", "harbor", "hazel", "iris", "jade", "lark", "laurel", "leaf", "lilac", "moss", "ocean", "olive",
  "orchid", "pearl", "pine", "plum", "quartz", "reed", "river", "rose", "sage", "sand", "shore", "sienna", "sky", "slate", "sol", "spruce",
  "stone", "teal", "thistle", "timber", "vale", "violet", "wave", "willow", "wind", "wren", "yarrow", "zinc", "zen", "zest", "zephyr",
]);

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

function dashboardAccessCode() {
  const values = new Uint32Array(5);
  crypto.getRandomValues(values);
  const words = Array.from(values.slice(0, 4), (value) => DASHBOARD_ACCESS_WORDS[value % DASHBOARD_ACCESS_WORDS.length]);
  return `${words.join("-")}-${String(values[4] % 10_000).padStart(4, "0")}`;
}

function dashboardAccessKey(code) {
  return `crm-dashboard-access:${code}`;
}

function requestedView(value) {
  return value === "client-desk" ? "client-desk" : "dashboard";
}

function parseSyncRequest(payload) {
  const requested = Array.isArray(payload?.sources) ? payload.sources : DEFAULT_SOURCES;
  const sources = [...new Set(requested.filter((source) => source === "ghl" || source === "ghl-conversations" || source === "ghl-message-export" || source === "stripe"))];
  if (!sources.length) throw new Error("sources must contain ghl, ghl-conversations, ghl-message-export, and/or stripe");
  const requestedLimit = Number(payload?.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 25;
  const requestedPages = Number(payload?.pages);
  // Message-export cursors are valid only briefly, so a deliberate manual run
  // consumes multiple pages immediately. Cap it to protect Worker runtime.
  const pages = Number.isInteger(requestedPages) ? Math.min(Math.max(requestedPages, 1), 8) : 8;
  return { sources, limit, pages };
}

export function parseQueueLimit(value) {
  if (value == null || value === "") return 25;
  const requestedLimit = Number(value);
  return Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 25;
}

export function parseContactSearch(value) {
  const query = String(value || "").trim();
  if (!query) return null;
  if (query.length < 2) throw new Error("search needs at least 2 characters");
  return query.slice(0, 100);
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
    // The shell has no data or action controls. Data endpoints remain protected.
    // Browser sessions come only from /dashboard-access/:code (never a pasted secret).
    const dashboardAccess = url.pathname.match(/^\/dashboard-access\/([^/]+)$/);
    if (request.method === "GET" && dashboardAccess) {
      const code = decodeURIComponent(dashboardAccess[1]);
      const accessKey = dashboardAccessKey(code);
      const valid = await env.PORTAL_KV.get(accessKey);
      if (!valid) return html("<p>Dashboard access link expired. Generate a new one from the operator session.</p>");
      await env.PORTAL_KV.delete(accessKey);
      const embed = url.searchParams.get("embed") === "1" ? "?embed=1" : "";
      const destination = valid === "client-desk" ? "/client-desk" : "/";
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${destination}${embed}`,
          "Set-Cookie": await dashboardSessionCookie(env),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/") {
      const denied = await requireDashboardReadAuth(request, env);
      const status = denied ? null : await mirrorStatus(env.CRM_DB, new Date().toISOString());
      return html(dashboardHtml(status));
    }
    if (request.method === "GET" && url.pathname === "/client-desk") {
      const denied = await requireDashboardReadAuth(request, env);
      return denied || html(clientDeskHtml());
    }

    try {
      if (request.method === "POST" && url.pathname === "/dashboard-session") {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
        const cookie = await dashboardSessionCookie(env);
        return json(200, { success: true, expiresInSeconds: 8 * 60 * 60 }, { "Set-Cookie": cookie });
      }
      if (request.method === "POST" && url.pathname === "/dashboard-access-link") {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
        const code = dashboardAccessCode();
        const view = requestedView(url.searchParams.get("view"));
        await env.PORTAL_KV.put(dashboardAccessKey(code), view, { expirationTtl: DASHBOARD_ACCESS_TTL_SECONDS });
        return json(200, {
          success: true,
          expiresInSeconds: DASHBOARD_ACCESS_TTL_SECONDS,
          url: `${url.origin}/dashboard-access/${code}`,
        }, { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
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
      const ledgerCutoverDecision = url.pathname.match(/^\/ledger-cutover\/candidates\/([^/]+)\/decision$/);
      if (request.method === "POST" && ledgerCutoverDecision) {
        const denied = await requireReviewWriteAuth(request, env);
        if (denied) return denied;
        const payload = await actionPayload(request);
        const result = await decideLedgerCutoverCandidate(
          env.CRM_DB,
          decodeURIComponent(ledgerCutoverDecision[1]),
          payload.decision,
          payload.reviewedBy,
          new Date().toISOString(),
        );
        return json(200, { success: true, result });
      }
      const contactDetail = url.pathname.match(/^\/contacts\/([^/]+)$/);
      const clientDeskDetail = url.pathname.match(/^\/client-desk\/contacts\/([^/]+)$/);
      if (request.method === "GET" && (["/status", "/operations", "/contacts", "/client-desk/contacts", "/ledger-cutover", "/reconciliation", "/reconciliation/queue", "/reconciliation/review"].includes(url.pathname) || contactDetail || clientDeskDetail)) {
        const denied = await requireDashboardReadAuth(request, env);
        if (denied) return denied;
      } else {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return json(200, { success: true, worker: "amari-crm-mirror", authActive: workerAuthActive(env), ...(await mirrorStatus(env.CRM_DB, new Date().toISOString())) });
      }
      if (request.method === "GET" && url.pathname === "/operations") {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await activeClientOperations(env.CRM_DB, limit, new Date().toISOString())),
        });
      }
      if (request.method === "GET" && url.pathname === "/ledger-cutover") {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        return json(200, { success: true, worker: "amari-crm-mirror", ...(await ledgerCutoverReview(env.CRM_DB, limit)) });
      }
      if (request.method === "GET" && url.pathname === "/contacts") {
        const query = parseContactSearch(url.searchParams.get("query"));
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          contacts: await searchContacts(env.CRM_DB, query, limit),
        });
      }
      if (request.method === "GET" && url.pathname === "/client-desk/contacts") {
        const query = parseContactSearch(url.searchParams.get("query"));
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        const scope = url.searchParams.get("scope") === "all" ? "all" : "clients";
        return json(200, { success: true, worker: "amari-crm-mirror", contacts: await clientDeskContacts(env.CRM_DB, { query, limit, scope }) });
      }
      if (request.method === "GET" && clientDeskDetail) {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        const profile = await contactProfile(env.CRM_DB, decodeURIComponent(clientDeskDetail[1]), limit, new Date().toISOString());
        return profile ? json(200, { success: true, worker: "amari-crm-mirror", ...profile }) : json(404, { error: "contact not found" });
      }
      if (request.method === "GET" && contactDetail) {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        const profile = await contactProfile(
          env.CRM_DB,
          decodeURIComponent(contactDetail[1]),
          limit,
          new Date().toISOString(),
        );
        return profile
          ? json(200, { success: true, worker: "amari-crm-mirror", ...profile })
          : json(404, { error: "contact not found" });
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
        const { sources, limit, pages } = parseSyncRequest(payload);
        const results = await syncRequestedProviders(env, sources, limit, new Date().toISOString(), pages);
        console.log(JSON.stringify({ event: "crm_mirror_sync", sources, limit, pages, results }));
        return json(200, { success: true, sources, limit, pages, results });
      }
      return json(404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "crm_mirror_error", path: url.pathname, message }));
      return json(500, { error: "CRM mirror request failed" });
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledSync(env, new Date().toISOString()));
  },
};

export { parseSyncRequest };
