// Staff automations read API (DASHBOARD-PLAN v1 backend) — the per-contact automation
// timeline and the failures table, read from the shared amari-automation D1 spine.
//
//   GET /api/staff-automations?view=activity[&sinceHours=48]   — today/yesterday feed, all contacts
//   GET /api/staff-automations?view=contact&contactId=<id>
//   GET /api/staff-automations?view=failures[&sinceHours=168]
//   GET /api/staff-automations?view=registry
//   GET /api/staff-automations?view=automation&engine=<reminder|nurture>&key=<key>
//
// Staff-JWT gated like every staff endpoint. Read-only: no writes, no GHL calls. Until the
// shared D1 exists (AUTOMATION_DB binding), returns 200 { configured: false } so the future
// staff tab can render an honest empty state instead of erroring.

import { requireStaffAuth, requireEbenStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import {
  contactAutomationIdentityView,
  failuresView,
  activityView,
  automationExecutionView,
  automationFamilyExecutionView,
} from "../lib/automation-views.js";
import {
  REGISTRY_VERSION,
  automationDefinitions,
  findAutomationDefinition,
  eventEvidence,
  registryEvidence,
} from "../lib/automation-registry.js";
import {
  automationFamilies,
  automationFamily,
  automationInventorySummary,
  familyRegistryEvidence,
} from "../lib/automation-families.js";
import {
  readExceptionQueue,
  readRecentSourceEvents,
  readReliabilityHealth,
  readSourceEventDetail,
  readReliabilityCounts,
  recordEvidenceAccess,
} from "../lib/reliability-store.js";
import {
  FOLLOW_UP_FAMILY, FOLLOW_UP_RELIABILITY_ROUTE,
  NO_SHOW_MISSED_COUNT_FAMILY, NO_SHOW_COUNTER_RELIABILITY_ROUTE,
} from "../lib/reliability-contract.js";

const RELIABILITY_ROUTES = new Map([
  [FOLLOW_UP_FAMILY, FOLLOW_UP_RELIABILITY_ROUTE],
  [NO_SHOW_MISSED_COUNT_FAMILY, NO_SHOW_COUNTER_RELIABILITY_ROUTE],
]);

const VALID_CONTACT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_AUTOMATION_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VALID_FAMILY_KEY = VALID_AUTOMATION_KEY;
const VALID_ENGINES = new Set(["reminder", "nurture"]);
const VALID_SOURCE_EVENT_ID = /^src_[a-f0-9]{64}$/;
const DEFAULT_FAILURE_WINDOW_HOURS = 168; // one week
const DEFAULT_ACTIVITY_WINDOW_HOURS = 48; // today + yesterday
const CRM_WORKER_CONTACTS_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/contacts";
const CRM_WORKER_AUTOMATIONS_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/automations/people";
const CRM_WORKER_FAMILIES_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/automations/families";
const CRM_WORKER_TIMEOUT_MS = 10_000;
const REMINDER_ENGINE_URL = "https://reminder-engine.eben-fa2.workers.dev";

async function reminderRuntimeEvidence(context, flowKey) {
  if (!context.env.WORKER_AUTH_SECRET) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRM_WORKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${REMINDER_ENGINE_URL}/runtime-status?flow=${encodeURIComponent(flowKey)}`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` }, signal: controller.signal,
    });
    if (!response.ok) return null;
    const runtime = (await response.json()).runtime || null;
    return runtime?.flow?.key === flowKey ? runtime : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function contactIdentityForReference(context, contactReference) {
  if (!context.env.WORKER_AUTH_SECRET) return { ownedContactId: contactReference, providerContactId: null, name: null, phone: null, state: "unavailable" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRM_WORKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${CRM_WORKER_CONTACTS_URL}?limit=20&query=${encodeURIComponent(contactReference)}`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` },
      signal: controller.signal,
    });
    if (!response.ok) return { ownedContactId: contactReference, providerContactId: null, name: null, phone: null, state: "unavailable" };
    const body = await response.json();
    const contact = (Array.isArray(body.contacts) ? body.contacts : [])
      .find((candidate) => String(candidate.id || "") === contactReference
        || String(candidate.provider_contact_id || "") === contactReference);
    if (!contact) return { ownedContactId: contactReference, providerContactId: null, name: null, phone: null, state: "owned_contact_not_found" };
    return {
      ownedContactId: String(contact.id),
      providerContactId: contact.provider_contact_id ? String(contact.provider_contact_id) : null,
      name: contact.display_name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.name || contact.email_normalized || contact.email || null,
      phone: contact.phone_e164 || contact.phone || null,
      state: contact.provider_contact_id ? "resolved" : "owned_only",
    };
  } catch {
    return { ownedContactId: contactReference, providerContactId: null, name: null, phone: null, state: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

async function withOwnedPeople(context, enrollments) {
  return Promise.all((enrollments || []).map(async (enrollment) => {
    if (!enrollment.contactId) return enrollment;
    const person = await contactIdentityForReference(context, enrollment.contactId);
    return { ...enrollment, contactId: person.ownedContactId, contactName: person.name, contactPhone: person.phone, providerContactId: person.providerContactId };
  }));
}

async function workerPersonAutomationEvidence(context, ownedContactId) {
  if (!context.env.WORKER_AUTH_SECRET) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRM_WORKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${CRM_WORKER_AUTOMATIONS_URL}/${encodeURIComponent(ownedContactId)}`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeWorkerPersonEvents(events = []) {
  const terminalByRef = new Map(events
    .filter((event) => event.action === "delivery_status" && event.messageRef && ["delivered", "failed", "bounced"].includes(event.outcome))
    .map((event) => [event.messageRef, event.outcome]));
  const deliveryGapCodes = new Set(["delivery_outcome_not_recorded", "delivery_outcome_pending", "email_final_delivery_unavailable"]);
  return events.map((event) => {
    const raw = {
      engine: event.engine,
      flow_key: event.flowKey,
      definition_version: event.definitionVersion,
      action: event.action,
      outcome: event.outcome,
      channel: event.channel,
      message_ref: event.messageRef,
    };
    const refreshed = eventEvidence(raw, { terminalOutcome: terminalByRef.get(event.messageRef) || null });
    const retained = (event.evidence?.gaps || []).filter((gap) => !deliveryGapCodes.has(gap.code));
    const gaps = [...retained, ...refreshed.gaps].filter((gap, index, all) => all.findIndex((candidate) => candidate.code === gap.code) === index);
    const displayOutcome = event.action === "send" && event.outcome === "sent"
      ? (event.channel === "email" ? "Accepted by Gmail" : "Accepted by SMS provider")
      : event.action === "delivery_status" && event.outcome === "delivered"
        ? "Delivered"
        : event.displayOutcome;
    return { ...event, displayOutcome, evidence: { ...(event.evidence || {}), source: refreshed.source, gaps } };
  });
}

async function workerFamilyAutomationEvidence(context, familyKey) {
  if (!context.env.WORKER_AUTH_SECRET) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRM_WORKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${CRM_WORKER_FAMILIES_URL}/${encodeURIComponent(familyKey)}`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function contactIdentityGaps(state) {
  if (state === "resolved") return [];
  if (state === "owned_only") return [{
    code: "provider_identity_not_applicable",
    label: "This is an owned-only person. Evidence is queried by Amari person ID; no former-provider history can exist for that identity.",
  }];
  if (state === "owned_contact_not_found") return [{
    code: "owned_contact_not_found",
    label: "This person ID was not found in the owned CRM mirror, so identity-linked automation evidence could not be verified.",
  }];
  return [{
    code: "identity_crosswalk_unavailable",
    label: "The owned CRM identity crosswalk was unavailable. Evidence below is limited to rows already keyed by the Amari person ID.",
  }];
}

function windowHours(url, fallback) {
  return Math.min(
    Math.max(parseInt(url.searchParams.get("sinceHours") || String(fallback), 10) || fallback, 1),
    24 * 90,
  );
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS") });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"), "Content-Type": "application/json" };
  const { error, payload } = await requireEbenStaffAuth(context, headers);
  if (error) return error;
  if (!context.env.WORKER_AUTH_SECRET) return new Response(JSON.stringify({ error: "Workflow runtime is not configured" }), { status: 503, headers });
  const body = await context.request.json().catch(() => null);
  const view = new URL(context.request.url).searchParams.get("view");
  const path = view === "workflow-draft" ? "/workflow-draft" : view === "workflow-publish" ? "/workflow-publish" : null;
  if (!path || !body) return new Response(JSON.stringify({ error: "Invalid workflow operation" }), { status: 400, headers });
  const response = await fetch(`${REMINDER_ENGINE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}`, "Content-Type": "application/json", "X-Staff-Actor": String(payload?.user || "Staff") },
    body: JSON.stringify(body),
  });
  const result = await response.text();
  return new Response(result, { status: response.status, headers });
}

export async function onRequestGet(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"),
    "Content-Type": "application/json",
  };

  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;

  const url = new URL(context.request.url);
  const view = url.searchParams.get("view");
  const db = context.env.AUTOMATION_DB;
  const evidence = registryEvidence({ executionStoreConfigured: !!db });
  const familyEvidence = familyRegistryEvidence();

  try {
    if (view === "reliability") {
      const nowMs = Date.now();
      const requestedFamily = (url.searchParams.get("family") || FOLLOW_UP_FAMILY).trim();
      const reliabilityRoute = RELIABILITY_ROUTES.get(requestedFamily);
      if (!reliabilityRoute) {
        return new Response(JSON.stringify({ error: "Unknown reliability family" }), { status: 400, headers });
      }
      const isEben = String(payload?.user || "").toLowerCase() === "eben";
      const isGarrett = String(payload?.user || "").toLowerCase() === "garrett";
      if (!isEben && !isGarrett) {
        return new Response(JSON.stringify({ error: "Reliability evidence is restricted to assigned staff" }), { status: 403, headers });
      }
      const health = await readReliabilityHealth(db, {
        family: requestedFamily,
        nowMs,
        maxAgeMs: 24 * 60 * 60 * 1000,
      });
      if (!db) {
        return new Response(JSON.stringify({
          success: true, configured: false, family: requestedFamily, health,
          route: reliabilityRoute, sourceEvents: [], exceptions: [], sourceEventDetail: null,
        }), { status: 200, headers });
      }
      if (!health.schemaProven || health.reason === "authority_read_failed") {
        return new Response(JSON.stringify({
          success: true, configured: true, family: requestedFamily, health,
          route: reliabilityRoute, sourceEvents: [], exceptions: [], sourceEventDetail: null,
          access: isEben ? "evidence_control" : "assigned_actions_only",
        }), { status: 200, headers });
      }
      const sourceEventId = (url.searchParams.get("sourceEventId") || "").trim();
      if (sourceEventId && !VALID_SOURCE_EVENT_ID.test(sourceEventId)) {
        return new Response(JSON.stringify({ error: "Invalid sourceEventId" }), { status: 400, headers });
      }
      if (sourceEventId && !isEben) {
        return new Response(JSON.stringify({ error: "Source evidence is restricted to Eben" }), { status: 403, headers });
      }
      const queue = await readExceptionQueue(db, { family: requestedFamily });
      const exceptions = isEben
      ? queue
      : queue.filter((item) => String(item.accountable_owner || "").toLowerCase() === "garrett");
      const counts = await readReliabilityCounts(db, {
        family: requestedFamily, accountableOwner: isEben ? null : "Garrett",
      });
      const actor = isEben ? "Eben" : "Garrett";
      const sourceEventDetail = sourceEventId
        ? await readSourceEventDetail(db, sourceEventId, { family: requestedFamily })
        : null;
      if (sourceEventId && !sourceEventDetail) {
        return new Response(JSON.stringify({ error: "Reliability source event not found" }), { status: 404, headers });
      }
      await recordEvidenceAccess(db, {
        actor, family: requestedFamily,
        action: sourceEventId ? "view_source" : "view_summary",
        sourceEventId: sourceEventId || null, occurredAt: nowMs,
      });
      return new Response(JSON.stringify({
        success: true,
        configured: true,
        family: requestedFamily,
        route: reliabilityRoute,
        health,
        sourceEvents: isEben ? await readRecentSourceEvents(db, { family: requestedFamily }) : [],
        exceptions,
        sourceEventDetail,
        sourceEventTotal: isEben ? counts.sourceEventTotal : null,
        exceptionTotal: counts.exceptionTotal,
        access: isEben ? "evidence_control" : "assigned_actions_only",
      }), { status: 200, headers });
    }

    if (view === "registry") {
      return new Response(JSON.stringify({
        success: true,
        configured: !!db,
        registryVersion: REGISTRY_VERSION,
        definitions: automationDefinitions(),
        evidence,
      }), { status: 200, headers });
    }

    if (view === "families") {
      return new Response(JSON.stringify({
        success: true,
        configured: !!db,
        registryVersion: REGISTRY_VERSION,
        summary: automationInventorySummary(),
        families: automationFamilies(),
        evidence: {
          ...evidence,
          gaps: [...familyEvidence.gaps, ...evidence.gaps],
        },
      }), { status: 200, headers });
    }

    if (view === "family") {
      const key = (url.searchParams.get("key") || "").trim();
      if (!VALID_FAMILY_KEY.test(key)) {
        return new Response(JSON.stringify({ error: "Invalid automation family key" }), { status: 400, headers });
      }
      const family = automationFamily(key);
      if (!family) {
        return new Response(JSON.stringify({ error: "Automation family not found" }), { status: 404, headers });
      }
      const runtimeFlowKeys = family.runtimeFlowKeys;
      const initialRuntimes = runtimeFlowKeys.length
        ? (await Promise.all(runtimeFlowKeys.map((flowKey) => reminderRuntimeEvidence(context, flowKey)))).filter(Boolean)
        : [];
      const initialRuntime = initialRuntimes[0] || null;
      const workerExecution = !db && !initialRuntime ? await workerFamilyAutomationEvidence(context, family.key) : null;
      const execution = initialRuntime
        ? {
            enrollments: initialRuntimes.flatMap((runtime) => runtime.enrollments || []),
            events: initialRuntimes.flatMap((runtime) => runtime.events || []),
            coverage: { enrollmentsTruncated: false, eventsTruncated: false },
          }
        : db
          ? await automationFamilyExecutionView(db, family)
          : workerExecution || { enrollments: [], events: [], coverage: { enrollmentsTruncated: false, eventsTruncated: false } };
      const displayExecution = initialRuntime ? { ...execution, enrollments: await withOwnedPeople(context, execution.enrollments) } : execution;
      const executionConfigured = Boolean(initialRuntime || db || workerExecution?.configured);
      const executionEvidence = registryEvidence({ executionStoreConfigured: executionConfigured });
      return new Response(JSON.stringify({
        success: true,
        configured: executionConfigured,
        registryVersion: REGISTRY_VERSION,
        family,
        ...displayExecution,
        runtime: initialRuntime ? { verified: initialRuntimes.length === runtimeFlowKeys.length, flows: initialRuntimes } : { verified: false, flows: [] },
        evidence: {
          ...executionEvidence,
          gaps: [...family.evidence.gaps, ...executionEvidence.gaps, ...(workerExecution?.evidence?.gaps || [])],
        },
      }), { status: 200, headers });
    }

    if (view === "automation") {
      const engine = (url.searchParams.get("engine") || "").trim();
      const key = (url.searchParams.get("key") || "").trim();
      if (!VALID_ENGINES.has(engine) || !VALID_AUTOMATION_KEY.test(key)) {
        return new Response(JSON.stringify({ error: "Invalid automation engine or key" }), { status: 400, headers });
      }
      const definition = findAutomationDefinition(engine, key);
      if (!definition) {
        return new Response(JSON.stringify({ error: "Automation definition not found" }), { status: 404, headers });
      }
      const execution = db
        ? await automationExecutionView(db, { engine, key })
        : { enrollments: [], events: [], coverage: { enrollmentsTruncated: false, eventsTruncated: false } };
      return new Response(JSON.stringify({
        success: true,
        configured: !!db,
        registryVersion: REGISTRY_VERSION,
        definition,
        ...execution,
        evidence,
      }), { status: 200, headers });
    }

    if (view === "contact") {
      const contactReference = (url.searchParams.get("contactId") || "").trim();
      if (!VALID_CONTACT_ID.test(contactReference)) {
        return new Response(JSON.stringify({ error: "Invalid contactId" }), { status: 400, headers });
      }
      const identity = await contactIdentityForReference(context, contactReference);
      const ownedContactId = identity.ownedContactId;
      const contactEvidence = {
        ...evidence,
        gaps: [...evidence.gaps, ...contactIdentityGaps(identity.state)],
      };
      if (!db) {
        const workerEvidence = await workerPersonAutomationEvidence(context, ownedContactId);
        if (workerEvidence) {
          const normalizedWorkerEvidence = { ...workerEvidence, events: normalizeWorkerPersonEvents(workerEvidence.events) };
          const proxiedRegistryEvidence = registryEvidence({ executionStoreConfigured: Boolean(workerEvidence.configured) });
          return new Response(JSON.stringify({
            ...normalizedWorkerEvidence,
            success: true,
            evidence: {
              ...proxiedRegistryEvidence,
              gaps: [
                ...proxiedRegistryEvidence.gaps,
                ...contactIdentityGaps(identity.state),
                ...(workerEvidence.evidence?.gaps || []),
              ],
            },
          }), { status: 200, headers });
        }
        return new Response(JSON.stringify({
          success: true,
          configured: false,
          contactId: ownedContactId,
          providerContactId: identity.providerContactId,
          enrollments: [],
          events: [],
          upgradeOffer: null,
          confirmations: [],
          lpOnboarding: null,
          coverage: { eventLimit: 200, eventsTruncated: false },
          evidence: contactEvidence,
        }), { status: 200, headers });
      }
      const data = await contactAutomationIdentityView(db, {
        ownedContactId,
        providerContactId: identity.providerContactId,
      });
      return new Response(JSON.stringify({ success: true, configured: true, ...data, evidence: contactEvidence }), { status: 200, headers });
    }

    if (view === "activity") {
      const sinceHours = windowHours(url, DEFAULT_ACTIVITY_WINDOW_HOURS);
      const events = db ? await activityView(db, { sinceMs: Date.now() - sinceHours * 3600000 }) : [];
      return new Response(JSON.stringify({ success: true, configured: !!db, sinceHours, events, evidence }), { status: 200, headers });
    }

    if (view === "failures") {
      const sinceHours = windowHours(url, DEFAULT_FAILURE_WINDOW_HOURS);
      const failures = db ? await failuresView(db, { sinceMs: Date.now() - sinceHours * 3600000 }) : [];
      return new Response(JSON.stringify({ success: true, configured: !!db, sinceHours, failures, evidence }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Unknown view (use families, family, registry, automation, activity, contact, failures, or reliability)" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Query failed: ${String((err && err.message) || err)}` }), { status: 500, headers });
  }
}
