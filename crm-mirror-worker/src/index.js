import { requireWorkerAuth, workerAuthActive } from "../../functions/lib/worker-auth.js";
import { dashboardHtml } from "./dashboard.js";
import { clientDeskHtml } from "./client-desk.js";
import { dashboardSessionActor, dashboardSessionCookie, hasDashboardSession, hasReviewSession, reviewSessionCookie } from "./dashboard-session.js";
import { deliveryReadiness } from "./owned-sender.js";
import {
  activeClientOperations,
  communicationsInbox,
  consentReviewQueue,
  classifyPurchase,
  deleteClientNote,
  deleteClientTask,
  clientDeskContacts,
  contactProfile,
  decideLedgerCutoverCandidate,
  decideReconciliationCandidate,
  findContactIdByGhlId,
  mirrorReadiness,
  mirrorStatus,
  ledgerCutoverReview,
  reconciliationQueue,
  reconciliationReview,
  reconciliationStatus,
  recordRealtimeGhlMessage,
  recordGhlWebhookEvent,
  markClientDeskSeen,
  searchContacts,
  upsertGhlAppointment,
  upsertGhlContact,
  upsertClientNote,
  upsertClientTask,
  recordConsentObservation,
} from "./repository.js";
import { nativeBookingConsentObservations, normalizeGhlAppointment, normalizeGhlContact, normalizeGhlMessage, normalizeGhlNote, normalizeGhlTask } from "./normalizers.js";
import { fetchGhlContact } from "./providers.js";
import { runScheduledSync, syncRequestedProviders } from "./sync.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const DEFAULT_SOURCES = ["ghl", "stripe", "stripe-invoices"];
const DASHBOARD_ACCESS_TTL_SECONDS = 5 * 60;
const GHL_ED25519_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=\n-----END PUBLIC KEY-----";
const DASHBOARD_ACCESS_WORDS = Object.freeze([
  "aloe", "amber", "apricot", "arc", "ash", "bay", "birch", "bloom", "brook", "cedar", "clay", "cove", "dawn", "dune", "elm", "fern",
  "field", "flint", "glen", "gold", "grove", "harbor", "hazel", "iris", "jade", "lark", "laurel", "leaf", "lilac", "moss", "ocean", "olive",
  "orchid", "pearl", "pine", "plum", "quartz", "reed", "river", "rose", "sage", "sand", "shore", "sienna", "sky", "slate", "sol", "spruce",
  "stone", "teal", "thistle", "timber", "vale", "violet", "wave", "willow", "wind", "wren", "yarrow", "zinc", "zen", "zest", "zephyr",
]);

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function pemToBytes(pem) {
  const base64 = pem.replace(/-----[^-]+-----|\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function validGhlSignature(rawBody, signature) {
  if (!signature) return false;
  try {
    const key = await crypto.subtle.importKey("spki", pemToBytes(GHL_ED25519_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "Ed25519" }, key, pemToBytes(`-----BEGIN SIGNATURE-----\n${signature}\n-----END SIGNATURE-----`), new TextEncoder().encode(rawBody));
  } catch { return false; }
}

async function webhookFallbackId(payload, data, rawBody) {
  const sourceId = data.messageId || data.emailMessageId || data.id;
  const occurredAt = data.dateAdded || payload.timestamp;
  if (sourceId && occurredAt) return `${payload.type}:${sourceId}:${occurredAt}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  return `${payload.type || "unknown"}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function processGhlWebhook(request, env) {
  const rawBody = await request.text();
  if (rawBody.length > 262144 || !await validGhlSignature(rawBody, request.headers.get("X-GHL-Signature"))) return json(401, { error: "invalid webhook signature" });
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { error: "invalid JSON" }); }
  if (payload.locationId !== env.GHL_LOCATION_ID) return json(202, { accepted: false });
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const now = new Date().toISOString();
  const webhookId = String(payload.webhookId || await webhookFallbackId(payload, data, rawBody));
  const message = (payload.type === "InboundMessage" || payload.type === "OutboundMessage")
    ? normalizeGhlMessage(data, data.conversationId, data.contactId) : null;
  const finish = async (status, body, projected) => {
    const recorded = await recordGhlWebhookEvent(env.CRM_DB, {
      id: webhookId, type: String(payload.type || "unknown"), contactExternalId: data.contactId || null,
      conversationExternalId: data.conversationId || null, occurredAt: data.dateAdded || payload.timestamp || null,
      processingState: projected ? "projected" : "observed",
    }, now);
    return json(status, { accepted: true, ...body, duplicate: !recorded });
  };
  if (["ContactCreate", "ContactUpdate", "ContactDndUpdate", "ContactTagUpdate"].includes(payload.type) && data.contactId) {
    const contact = normalizeGhlContact(await fetchGhlContact(env, data.contactId));
    if (contact) await upsertGhlContact(env.CRM_DB, contact, now);
    return finish(200, { projected: Boolean(contact) }, Boolean(contact));
  }
  if (["AppointmentCreate", "AppointmentUpdate"].includes(payload.type) && data.contactId) {
    const contactId = await findContactIdByGhlId(env.CRM_DB, data.contactId);
    const appointment = normalizeGhlAppointment(data, data.contactId);
    if (contactId && appointment) await upsertGhlAppointment(env.CRM_DB, appointment, contactId, now);
    return finish(200, { projected: Boolean(contactId && appointment) }, Boolean(contactId && appointment));
  }
  if (["NoteCreate", "NoteUpdate", "NoteDelete"].includes(payload.type) && data.contactId) {
    const note = normalizeGhlNote(data);
    if (payload.type === "NoteDelete") {
      const noteId = String(data.id || data.noteId || "");
      if (noteId) await deleteClientNote(env.CRM_DB, noteId);
      return finish(200, { projected: Boolean(noteId) }, Boolean(noteId));
    }
    const contactId = await findContactIdByGhlId(env.CRM_DB, data.contactId);
    if (contactId && note) {
      await upsertClientNote(env.CRM_DB, note, contactId, now);
      for (const observation of nativeBookingConsentObservations(note)) {
        await recordConsentObservation(env.CRM_DB, observation, contactId, now);
      }
    }
    return finish(200, { projected: Boolean(contactId && note) }, Boolean(contactId && note));
  }
  if (["TaskCreate", "TaskComplete", "TaskDelete"].includes(payload.type) && data.contactId) {
    const task = normalizeGhlTask(data);
    if (payload.type === "TaskDelete") {
      const taskId = String(data.id || data.taskId || "");
      if (taskId) await deleteClientTask(env.CRM_DB, taskId);
      return finish(200, { projected: Boolean(taskId) }, Boolean(taskId));
    }
    const contactId = await findContactIdByGhlId(env.CRM_DB, data.contactId);
    if (contactId && task) await upsertClientTask(env.CRM_DB, task, contactId, now);
    return finish(200, { projected: Boolean(contactId && task) }, Boolean(contactId && task));
  }
  if (!message) return finish(202, { projected: false }, false);
  const contactId = await findContactIdByGhlId(env.CRM_DB, message.contactExternalId);
  if (!contactId) return finish(202, { projected: false }, false);
  const recorded = await recordRealtimeGhlMessage(env.CRM_DB, message, contactId, now);
  return finish(200, { projected: true, messageDuplicate: recorded.duplicate }, true);
}

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-ancestors https://www.amarimethod.com https://amarimethod-website.pages.dev https://*.amarimethod-website.pages.dev",
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

function requestedStaffActor(value) {
  const actor = String(value || "").trim();
  return /^[A-Za-z][A-Za-z .'-]{0,78}$/.test(actor) ? actor : null;
}

function dashboardAccessRecord(value) {
  if (typeof value !== "string" || !value) return null;
  if (value === "client-desk" || value === "dashboard") return { view: value, actor: null };
  try {
    const parsed = JSON.parse(value);
    return { view: requestedView(parsed?.view), actor: requestedStaffActor(parsed?.actor) };
  } catch { return null; }
}

function parseSyncRequest(payload) {
  const requested = Array.isArray(payload?.sources) ? payload.sources : DEFAULT_SOURCES;
  const sources = [...new Set(requested.filter((source) => source === "ghl" || source === "ghl-conversations" || source === "ghl-message-export" || source === "ghl-client-records" || source === "stripe" || source === "stripe-invoices" || source === "consents"))];
  if (!sources.length) throw new Error("sources must contain ghl, ghl-conversations, ghl-message-export, ghl-client-records, stripe, and/or stripe-invoices");
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

// The operational Desk deliberately loads the complete mirrored contact index.
// Diagnostic/review queues stay at their smaller bounded limit above.
export function parseClientDeskLimit(value) {
  if (value == null || value === "") return 1000;
  const requestedLimit = Number(value);
  return Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 1000;
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

async function actionPayload(request, maximum = 4096) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maximum) throw new Error("request body too large");
  try {
    return await request.json();
  } catch {
    throw new Error("invalid JSON");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhooks/ghl") return processGhlWebhook(request, env);
    // The shell has no data or action controls. Data endpoints remain protected.
    // Browser sessions come only from /dashboard-access/:code (never a pasted secret).
    const dashboardAccess = url.pathname.match(/^\/dashboard-access\/([^/]+)$/);
    if (request.method === "GET" && dashboardAccess) {
      const code = decodeURIComponent(dashboardAccess[1]);
      const accessKey = dashboardAccessKey(code);
      const valid = dashboardAccessRecord(await env.PORTAL_KV.get(accessKey));
      if (!valid) return html("<p>Dashboard access link expired. Generate a new one from the operator session.</p>");
      await env.PORTAL_KV.delete(accessKey);
      const destinationParams = new URLSearchParams();
      const embed = url.searchParams.get("embed") === "1";
      if (embed) destinationParams.set("embed", "1");
      const parentOrigin = url.searchParams.get("parent_origin");
      if (embed && parentOrigin === "https://www.amarimethod.com") {
        destinationParams.set("parent_origin", parentOrigin);
      }
      const destinationQuery = destinationParams.size ? `?${destinationParams}` : "";
      const destination = valid.view === "client-desk" ? "/client-desk" : "/";
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${destination}${destinationQuery}`,
          "Set-Cookie": await dashboardSessionCookie(env, valid.actor || "Staff"),
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
        const cookie = await dashboardSessionCookie(env, "Staff");
        return json(200, { success: true, expiresInSeconds: 8 * 60 * 60 }, { "Set-Cookie": cookie });
      }
      if (request.method === "POST" && url.pathname === "/dashboard-access-link") {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
        const code = dashboardAccessCode();
        const view = requestedView(url.searchParams.get("view"));
        const actor = requestedStaffActor(request.headers.get("X-Staff-Actor"));
        await env.PORTAL_KV.put(dashboardAccessKey(code), JSON.stringify({ view, actor }), { expirationTtl: DASHBOARD_ACCESS_TTL_SECONDS });
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
      const clientDeskSeen = url.pathname.match(/^\/client-desk\/contacts\/([^/]+)\/seen$/);
      if (request.method === "POST" && clientDeskSeen) {
        const actor = await dashboardSessionActor(request, env);
        if (!actor) return json(401, { error: "staff session required" });
        if (request.headers.get("Origin") !== url.origin) return json(403, { error: "invalid request origin" });
        const contactId = decodeURIComponent(clientDeskSeen[1]);
        const profile = await contactProfile(env.CRM_DB, contactId, 1, new Date().toISOString());
        if (!profile?.contact) return json(404, { error: "contact not found" });
        await markClientDeskSeen(env.CRM_DB, contactId, actor, new Date().toISOString());
        return json(200, { success: true });
      }
      const contactDetail = url.pathname.match(/^\/contacts\/([^/]+)$/);
      const clientDeskDetail = url.pathname.match(/^\/client-desk\/contacts\/([^/]+)$/);
      if (request.method === "GET" && (["/status", "/readiness", "/operations", "/contacts", "/client-desk/contacts", "/communications/inbox", "/consent-review", "/ledger-cutover", "/reconciliation", "/reconciliation/queue", "/reconciliation/review", "/sender/readiness"].includes(url.pathname) || contactDetail || clientDeskDetail)) {
        const denied = await requireDashboardReadAuth(request, env);
        if (denied) return denied;
      } else {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return json(200, { success: true, worker: "amari-crm-mirror", authActive: workerAuthActive(env), ...(await mirrorStatus(env.CRM_DB, new Date().toISOString())) });
      }
      if (request.method === "GET" && url.pathname === "/readiness") {
        return json(200, { success: true, worker: "amari-crm-mirror", ...(await mirrorReadiness(env.CRM_DB, new Date().toISOString())) });
      }
      if (request.method === "GET" && url.pathname === "/sender/readiness") {
        return json(200, { success: true, worker: "amari-crm-mirror", ...deliveryReadiness(env) });
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
      if (request.method === "GET" && url.pathname === "/communications/inbox") {
        const query = parseContactSearch(url.searchParams.get("query"));
        const limit = parseClientDeskLimit(url.searchParams.get("limit"));
        const actor = await dashboardSessionActor(request, env) || "Staff";
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          threads: await communicationsInbox(env.CRM_DB, { query, limit, actor }),
        });
      }
      if (request.method === "GET" && url.pathname === "/consent-review") {
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        return json(200, { success: true, worker: "amari-crm-mirror", ...(await consentReviewQueue(env.CRM_DB, limit)) });
      }
      if (request.method === "GET" && clientDeskDetail) {
        const limit = parseClientDeskLimit(url.searchParams.get("limit"));
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
