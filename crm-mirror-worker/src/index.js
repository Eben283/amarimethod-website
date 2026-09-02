import { requireWorkerAuth, workerAuthActive } from "../../functions/lib/worker-auth.js";
import { dashboardHtml } from "./dashboard.js";
import { clientDeskHtml } from "./client-desk.js";
import { dashboardSessionActor, dashboardSessionCookie, dashboardSessionToken, hasDashboardSession, hasReviewSession, reviewSessionCookie } from "./dashboard-session.js";
import { CommunicationCommandError, communicationReadiness } from "./owned-sender.js";
import { GmailReplyReadinessError, gmailReplyReadiness } from "./gmail-reply-readiness.js";
import { createOwnedFollowup, listOwnedFollowups, setOwnedFollowupCompletion } from "./owned-followups.js";
import {
  captureOwnedManageCommand,
  captureOwnedScheduleCommand,
  claimOwnedAppointmentExecution,
  completeOwnedAppointmentExecution,
  failOwnedAppointmentExecution,
  linkOwnedAppointmentProviderRecord,
  OwnedAppointmentError,
  unlinkOwnedAppointmentProviderRecord,
} from "./owned-appointments.js";
import { appointmentProjectionReadiness } from "./appointment-projection-store.js";
import { ownedAppointmentAuthorityReadiness } from "./owned-appointment-readiness.js";
import { appointmentLifecycleDispatchReadiness } from "./appointment-lifecycle-dispatch.js";
import { listOwnedAppointmentSchedule } from "./owned-appointment-schedule.js";
import { OwnedAppointmentPaymentError, recordOwnedAppointmentPayment } from "./owned-appointment-payments.js";
import { OwnedAppointmentIdentityError, resolveOwnedAppointmentIdentity } from "./owned-appointment-identity.js";
import {
  activeClientOperations,
  communicationsInbox,
  communicationMirrorFreshness,
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
import { fetchGhlContact, withGhlProviderInvocation } from "./providers.js";
import { runScheduledSync, syncRequestedProviders } from "./sync.js";
import { personAutomationInspection } from "./person-automation-inspection.js";
import { familyAutomationInspection } from "./family-automation-inspection.js";
import { automationFamily } from "../../functions/lib/automation-families.js";
import { ownedQuizIntakeReadiness, OwnedQuizIntakeError, upsertOwnedQuizIntake } from "./owned-quiz-intake.js";
import { ownedQuizNurtureDispatchReadiness } from "./quiz-nurture-dispatch.js";
import { captureStaffCommunicationCommand, ownedEmailDispatchReadiness } from "./owned-email-dispatch.js";
import { ownedQuizRetentionReadiness } from "./owned-quiz-retention.js";
import {
  AppointmentRecoveryRequestError,
  captureAppointmentRecoveryRequest,
  listAppointmentRecoveryRequests,
} from "./appointment-recovery-requests.js";
import { MissedAppointmentTruthError, readMissedAppointmentTruth } from "./missed-appointment-truth.js";
import {
  captureOwnedAppointmentAttendance,
  OwnedAppointmentAttendanceError,
} from "./owned-appointment-attendance.js";

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

async function sha256Text(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    if (contactId && appointment) await upsertGhlAppointment(env.CRM_DB, appointment, contactId, now, {
      sourceKind: "webhook",
      providerEventId: webhookId,
      providerEventType: String(payload.type),
      providerOccurredAt: data.dateAdded || payload.timestamp || null,
      evidenceHash: await sha256Text(rawBody),
    });
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

const TRUSTED_STAFF_PARENT_ORIGINS = new Set([
  "https://amarimethod.com",
  "https://www.amarimethod.com",
]);

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-ancestors https://amarimethod.com https://www.amarimethod.com https://amarimethod-website.pages.dev https://*.amarimethod-website.pages.dev",
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
  const sources = [...new Set(requested.filter((source) => source === "owned-appointment-lifecycles" || source === "owned-quiz-nurture" || source === "owned-email-dispatch" || source === "ghl" || source === "ghl-conversations-recent" || source === "ghl-conversations" || source === "ghl-message-export" || source === "ghl-client-records" || source === "stripe" || source === "stripe-invoices" || source === "consents"))];
  if (!sources.length) throw new Error("sources must contain owned-appointment-lifecycles, owned-quiz-nurture, owned-email-dispatch, ghl, ghl-conversations-recent, ghl-conversations, ghl-message-export, ghl-client-records, stripe, stripe-invoices, and/or consents");
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
    env = withGhlProviderInvocation(env);
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
      const trustedEmbed = embed && TRUSTED_STAFF_PARENT_ORIGINS.has(parentOrigin);
      if (trustedEmbed) {
        destinationParams.set("parent_origin", parentOrigin);
      }
      const requestedContact = url.searchParams.get("contact");
      if (valid.view === "client-desk" && /^[A-Za-z0-9_-]{1,80}$/.test(requestedContact || "")) {
        destinationParams.set("contact", requestedContact);
      }
      const destinationQuery = destinationParams.size ? `?${destinationParams}` : "";
      const destination = valid.view === "client-desk" ? "/client-desk" : "/";
      // iOS may decline a third-party iframe cookie. For a trusted Staff embed,
      // carry the same signed session in a URL fragment; it never reaches the
      // server or referrers and Desk JS immediately removes it from the URL.
      const embeddedSession = trustedEmbed ? await dashboardSessionToken(env, valid.actor || "Staff") : null;
      const fragment = embeddedSession ? `#dashboard_session=${encodeURIComponent(embeddedSession)}` : "";
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${destination}${destinationQuery}${fragment}`,
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
      if (request.method === "POST" && url.pathname === "/communications/outbox") {
        const actor = await dashboardSessionActor(request, env);
        if (!actor) return json(401, { error: "staff_session_required" });
        if (request.headers.get("Origin") !== url.origin) return json(403, { error: "invalid_request_origin" });
        let payload;
        try {
          payload = await actionPayload(request, 12_000);
        } catch (error) {
          return json(400, { error: "invalid_request", detail: error instanceof Error ? error.message : String(error) });
        }
        const browserFields = new Set(["contactId", "channel", "idempotencyKey", "subject", "body"]);
        const unsupported = payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.keys(payload).filter((key) => !browserFields.has(key))
          : [];
        if (unsupported.length) return json(400, { error: "unsupported_fields", fields: unsupported });
        try {
          const command = await captureStaffCommunicationCommand(env.CRM_DB, { ...payload, actor }, new Date().toISOString());
          return json(command.deduped ? 200 : 201, { success: true, command });
        } catch (error) {
          if (error instanceof CommunicationCommandError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      const contactDetail = url.pathname.match(/^\/contacts\/([^/]+)$/);
      const clientDeskDetail = url.pathname.match(/^\/client-desk\/contacts\/([^/]+)$/);
      const automationPersonDetail = url.pathname.match(/^\/automations\/people\/([^/]+)$/);
      const automationFamilyDetail = url.pathname.match(/^\/automations\/families\/([^/]+)$/);
      if (request.method === "GET" && (["/status", "/readiness", "/appointments", "/appointments/readiness", "/appointments/missed-truth", "/appointments/recovery-requests", "/operations", "/contacts", "/client-desk/contacts", "/communications/inbox", "/communications/outbox/readiness", "/consent-review", "/ledger-cutover", "/reconciliation", "/reconciliation/queue", "/reconciliation/review", "/sender/readiness", "/quiz-intake/readiness", "/quiz-intake/retention-readiness"].includes(url.pathname) || contactDetail || clientDeskDetail || automationPersonDetail || automationFamilyDetail)) {
        const denied = await requireDashboardReadAuth(request, env);
        if (denied) return denied;
      } else {
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return json(200, { success: true, worker: "amari-crm-mirror", authActive: workerAuthActive(env), ...(await mirrorStatus(env.CRM_DB, new Date().toISOString())) });
      }
      if (request.method === "GET" && automationPersonDetail) {
        const reference = decodeURIComponent(automationPersonDetail[1]);
        const candidates = await searchContacts(env.CRM_DB, reference, 10);
        const contact = candidates.find((candidate) => String(candidate.id || "") === reference
          || String(candidate.provider_contact_id || "") === reference);
        if (!contact) return json(404, { error: "contact not found" });
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await personAutomationInspection(env.AUTOMATION_DB, {
            id: contact.id,
            ghl_contact_id: contact.provider_contact_id || null,
          })),
        });
      }
      if (request.method === "GET" && automationFamilyDetail) {
        const family = automationFamily(decodeURIComponent(automationFamilyDetail[1]));
        if (!family) return json(404, { error: "automation family not found" });
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          familyKey: family.key,
          ...(await familyAutomationInspection(env.AUTOMATION_DB, family)),
        });
      }
      if (request.method === "GET" && url.pathname === "/readiness") {
        return json(200, { success: true, worker: "amari-crm-mirror", ...(await mirrorReadiness(env.CRM_DB, new Date().toISOString())) });
      }
      if (request.method === "GET" && url.pathname === "/quiz-intake/readiness") {
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await ownedQuizIntakeReadiness(env.CRM_DB, new Date().toISOString())),
          nurtureDispatch: await ownedQuizNurtureDispatchReadiness(env.CRM_DB),
        }, { "Cache-Control": "no-store" });
      }
      if (request.method === "GET" && url.pathname === "/quiz-intake/retention-readiness") {
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await ownedQuizRetentionReadiness(env.CRM_DB, env.AUTOMATION_DB, new Date().toISOString())),
        }, { "Cache-Control": "no-store" });
      }
      if (request.method === "GET" && (url.pathname === "/sender/readiness" || url.pathname === "/communications/outbox/readiness")) {
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...(await communicationReadiness(env.CRM_DB, env)),
          emailDispatch: await ownedEmailDispatchReadiness(env.CRM_DB, env),
        });
      }
      if (request.method === "GET" && url.pathname === "/gmail/reply-readiness") {
        try {
          return json(200, {
            success: true,
            worker: "amari-crm-mirror",
            ...(await gmailReplyReadiness(env.CRM_DB, {
              actor: url.searchParams.get("actor"),
              limit: url.searchParams.get("limit"),
            })),
          }, { "Cache-Control": "no-store" });
        } catch (error) {
          if (error instanceof GmailReplyReadinessError) return json(400, { error: error.code });
          throw error;
        }
      }
      if (request.method === "GET" && url.pathname === "/owned-followups") {
        const state = url.searchParams.get("state") || "open";
        const limit = parseQueueLimit(url.searchParams.get("limit"));
        const page = await listOwnedFollowups(env.CRM_DB, { state, limit: Math.min(limit + 1, 100) });
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          followups: page.slice(0, limit),
          truncated: page.length > limit,
        });
      }
      if (request.method === "POST" && url.pathname === "/owned-followups") {
        const actor = requestedStaffActor(request.headers.get("X-Staff-Actor"));
        if (!actor) return json(400, { error: "valid staff actor required" });
        let payload;
        try { payload = await actionPayload(request); }
        catch (error) { return json(400, { error: error.message }); }
        try {
          if (payload.action === "create") {
            const followup = await createOwnedFollowup(env.CRM_DB, {
              contactId: payload.contactId,
              title: payload.title,
              dueOn: payload.dueOn,
              actor,
            });
            return json(201, { success: true, followup });
          }
          if (payload.action === "complete" || payload.action === "reopen") {
            const followup = await setOwnedFollowupCompletion(
              env.CRM_DB,
              payload.id,
              payload.action === "complete",
              actor,
            );
            return json(200, { success: true, followup });
          }
          return json(400, { error: "unknown follow-up action" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return json(message === "contact is not mirrored" || message === "follow-up not found" ? 404 : 400, { error: message });
        }
      }
      if (request.method === "POST" && url.pathname === "/contacts/quiz-intake") {
        // Defense in depth: this sensitive server-to-server write checks Worker auth again
        // at the route even though the global dispatcher has already denied unauthenticated
        // non-dashboard requests. The public browser never receives this bearer secret.
        const denied = requireWorkerAuth(request, env);
        if (denied) return denied;
        let payload;
        try {
          payload = await actionPayload(request, 24_000);
        } catch (error) {
          return json(400, { error: "invalid_request", detail: error instanceof Error ? error.message : String(error) });
        }
        try {
          const result = await upsertOwnedQuizIntake(env.CRM_DB, payload, new Date().toISOString());
          return json(result.deduped ? 200 : 201, { success: true, ...result });
        } catch (error) {
          if (error instanceof OwnedQuizIntakeError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      if (request.method === "POST" && url.pathname === "/appointments/attendance-commands") {
        const actor = requestedStaffActor(request.headers.get("X-Staff-Actor"));
        if (!new Set(["Eben", "Garrett"]).has(actor)) {
          return json(400, { error: "recognized_staff_actor_required" });
        }
        let payload;
        try {
          payload = await actionPayload(request, 2_000);
        } catch (error) {
          return json(400, { error: "invalid_request", detail: error instanceof Error ? error.message : String(error) });
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return json(400, { error: "invalid_request", detail: "JSON object required" });
        }
        const allowed = new Set([
          "appointmentId", "contactId", "idempotencyKey", "targetStatus", "expectedRevision",
        ]);
        const unsupported = payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.keys(payload).filter((key) => !allowed.has(key))
          : [];
        if (unsupported.length) return json(400, { error: "unsupported_fields", fields: unsupported });
        try {
          const command = await captureOwnedAppointmentAttendance(
            env.CRM_DB,
            { ...payload, actor },
            new Date().toISOString(),
          );
          return json(command.deduped ? 200 : 201, { success: true, command });
        } catch (error) {
          if (error instanceof OwnedAppointmentAttendanceError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      if (request.method === "POST" && url.pathname === "/appointments/commands") {
        const actor = requestedStaffActor(request.headers.get("X-Staff-Actor"));
        let payload;
        try {
          payload = await actionPayload(request, 8_000);
        } catch (error) {
          return json(400, { error: "invalid_request", detail: error instanceof Error ? error.message : String(error) });
        }
        if (!new Set(["Eben", "Garrett", "Client"]).has(actor)) {
          return json(400, { error: "recognized_staff_actor_required" });
        }
        if (actor === "Client" && payload?.action === "schedule") {
          return json(403, { error: "client_schedule_forbidden" });
        }
        const actionFields = {
          schedule: ["action", "contactId", "serviceId", "idempotencyKey", "startTime", "timezone"],
          manage: ["action", "manageAction", "contactId", "appointmentId", "idempotencyKey", "startTime", "timezone"],
          claim: ["action", "commandId"],
          "provider-link": ["action", "commandId", "provider", "providerRecordId", "providerCalendarId", "providerStatusRaw"],
          "provider-unlink": ["action", "commandId", "providerRecordId"],
          complete: ["action", "commandId", "result"],
          fail: ["action", "commandId", "error", "manualReview", "terminal"],
        };
        const allowed = new Set(actionFields[payload?.action] || ["action"]);
        const unsupported = payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.keys(payload).filter((key) => !allowed.has(key))
          : [];
        if (unsupported.length) return json(400, { error: "unsupported_fields", fields: unsupported });
        try {
          // Compatibility remains required until the separately gated GHL-off
          // rehearsal. The browser cannot weaken this deployment decision.
          const providerSyncRequired = env.APPOINTMENT_PROVIDER_MODE !== "owned_only";
          if (payload?.action === "schedule") {
            const appointment = await captureOwnedScheduleCommand(env.CRM_DB, {
              contactId: payload.contactId,
              serviceId: payload.serviceId,
              actor,
              idempotencyKey: payload.idempotencyKey,
              startTime: payload.startTime,
              timezone: payload.timezone,
            }, { providerSyncRequired });
            return json(appointment.deduped ? 200 : 201, { success: true, appointment });
          }
          if (payload?.action === "manage") {
            const command = await captureOwnedManageCommand(env.CRM_DB, {
              action: payload.manageAction,
              contactId: payload.contactId,
              appointmentId: payload.appointmentId,
              actor,
              idempotencyKey: payload.idempotencyKey,
              startTime: payload.startTime,
              timezone: payload.timezone,
            }, { providerSyncRequired });
            return json(command.deduped ? 200 : 201, { success: true, ...command });
          }
          const identity = { commandId: payload?.commandId, actor };
          if (payload?.action === "claim") {
            return json(200, { success: true, ...(await claimOwnedAppointmentExecution(env.CRM_DB, identity)) });
          }
          if (payload?.action === "provider-link") {
            const execution = await linkOwnedAppointmentProviderRecord(env.CRM_DB, {
              ...identity,
              provider: payload.provider,
              providerRecordId: payload.providerRecordId,
              providerCalendarId: payload.providerCalendarId,
              providerStatusRaw: payload.providerStatusRaw,
            });
            return json(200, { success: true, execution });
          }
          if (payload?.action === "provider-unlink") {
            const execution = await unlinkOwnedAppointmentProviderRecord(env.CRM_DB, {
              ...identity,
              providerRecordId: payload.providerRecordId,
            });
            return json(200, { success: true, execution });
          }
          if (payload?.action === "complete") {
            const execution = await completeOwnedAppointmentExecution(env.CRM_DB, {
              ...identity,
              result: payload.result,
            }, { providerSyncRequired });
            return json(200, { success: true, execution });
          }
          if (payload?.action === "fail") {
            const execution = await failOwnedAppointmentExecution(env.CRM_DB, {
              ...identity,
              error: payload.error,
              manualReview: payload.manualReview === true,
              terminal: payload.terminal === true,
            });
            return json(200, { success: true, execution });
          }
          return json(400, { error: "unsupported_appointment_action" });
        } catch (error) {
          if (error instanceof OwnedAppointmentError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      if (request.method === "GET" && url.pathname === "/appointments/recovery-requests") {
        try {
          const limit = parseQueueLimit(url.searchParams.get("limit"));
          const page = await listAppointmentRecoveryRequests(env.CRM_DB, {
            state: url.searchParams.get("state") === "all" ? "all" : "pending_review",
            limit: Math.min(limit + 1, 100),
          });
          return json(200, {
            success: true,
            worker: "amari-crm-mirror",
            requests: page.slice(0, limit),
            truncated: page.length > limit,
          }, { "Cache-Control": "no-store" });
        } catch (error) {
          if (error instanceof AppointmentRecoveryRequestError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      if (request.method === "GET" && url.pathname === "/appointments/missed-truth") {
        try {
          return json(200, {
            success: true,
            worker: "amari-crm-mirror",
            ...(await readMissedAppointmentTruth(env.CRM_DB, {
              contactId: url.searchParams.get("contactId"),
              limit: parseQueueLimit(url.searchParams.get("limit")),
            })),
          }, { "Cache-Control": "no-store" });
        } catch (error) {
          if (error instanceof MissedAppointmentTruthError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      if (request.method === "POST" && url.pathname === "/appointments/recovery-requests") {
        const actor = requestedStaffActor(request.headers.get("X-Staff-Actor"));
        if (actor !== "Client") return json(403, { error: "client_recovery_request_required" });
        let payload;
        try {
          payload = await actionPayload(request, 2_000);
        } catch (error) {
          return json(400, { error: "invalid_request", detail: error instanceof Error ? error.message : String(error) });
        }
        const allowed = new Set(["appointmentId", "contactId", "appointmentRevision"]);
        const unsupported = payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.keys(payload).filter((key) => !allowed.has(key))
          : [];
        if (unsupported.length) return json(400, { error: "unsupported_fields", fields: unsupported });
        try {
          const captured = await captureAppointmentRecoveryRequest(env.CRM_DB, payload, new Date().toISOString());
          return json(captured.deduped ? 200 : 201, { success: true, request: captured });
        } catch (error) {
          if (error instanceof AppointmentRecoveryRequestError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      if (request.method === "GET" && url.pathname === "/appointments/readiness") {
        const generatedAt = new Date().toISOString();
        const [projection, ownedAuthority, lifecycleDispatch] = await Promise.all([
          appointmentProjectionReadiness(env.CRM_DB, generatedAt),
          ownedAppointmentAuthorityReadiness(env.CRM_DB, generatedAt),
          appointmentLifecycleDispatchReadiness(env.CRM_DB),
        ]);
        const state = projection.state === "unavailable" || ownedAuthority.state === "unavailable"
          ? "unavailable"
          : projection.state === "attention" || ownedAuthority.state === "attention"
            ? "attention"
            : projection.state;
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...projection,
          state,
          ownedAuthority,
          lifecycleDispatch,
        });
      }
      const appointmentIdentity = url.pathname.match(/^\/appointments\/([^/]+)\/identity$/);
      if (request.method === "GET" && appointmentIdentity) {
        try {
          return json(200, {
            success: true,
            identity: await resolveOwnedAppointmentIdentity(
              env.CRM_DB,
              decodeURIComponent(appointmentIdentity[1]),
            ),
          }, { "Cache-Control": "no-store" });
        } catch (error) {
          if (error instanceof OwnedAppointmentIdentityError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      const appointmentPayment = url.pathname.match(/^\/appointments\/([^/]+)\/payment$/);
      if (request.method === "PUT" && appointmentPayment) {
        try {
          const payload = await actionPayload(request);
          const payment = await recordOwnedAppointmentPayment(
            env.CRM_DB,
            decodeURIComponent(appointmentPayment[1]),
            payload.contactId,
            payload,
            new Date().toISOString(),
          );
          return json(200, { success: true, payment });
        } catch (error) {
          if (error instanceof OwnedAppointmentPaymentError) {
            return json(error.status, { error: error.code, detail: error.message });
          }
          throw error;
        }
      }
      if (request.method === "GET" && url.pathname === "/appointments") {
        try {
          return json(200, {
            success: true,
            worker: "amari-crm-mirror",
            ...(await listOwnedAppointmentSchedule(env.CRM_DB, {
              startTime: url.searchParams.get("startTime"),
              endTime: url.searchParams.get("endTime"),
              includeCancelled: url.searchParams.get("includeCancelled") === "1",
              includeDetail: url.searchParams.get("detail") === "1",
            })),
          }, { "Cache-Control": "no-store" });
        } catch (error) {
          if (error instanceof TypeError) return json(400, { error: "invalid_appointment_range" });
          throw error;
        }
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
          freshness: await communicationMirrorFreshness(env.CRM_DB, new Date().toISOString()),
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
        if (!profile) return json(404, { error: "contact not found" });
        const automationEvidence = await personAutomationInspection(env.AUTOMATION_DB, profile.contact);
        let missedAppointmentTruth;
        try {
          missedAppointmentTruth = await readMissedAppointmentTruth(env.CRM_DB, {
            contactId: profile.contact.id,
            limit: 25,
          });
        } catch (error) {
          if (!(error instanceof MissedAppointmentTruthError)) throw error;
          missedAppointmentTruth = {
            version: "owned-missed-appointment-truth.v1",
            readOnly: true,
            mutableCounterWritten: false,
            authorityPromoted: false,
            state: "unavailable",
            reason: error.code,
            summary: null,
            legacyObservation: null,
            missedAppointments: [],
          };
        }
        return json(200, {
          success: true,
          worker: "amari-crm-mirror",
          ...profile,
          automationEvidence,
          missedAppointmentTruth,
        });
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
    ctx.waitUntil(runScheduledSync(withGhlProviderInvocation(env), new Date().toISOString()));
  },
};

export { parseSyncRequest };
