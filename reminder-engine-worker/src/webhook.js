// GHL appointment-webhook ingest — ON THE WORKER, so the appointment shadow can go live
// without touching the Pages deploy hold (2026-07-12 decision). GHL's webhook workflow POSTs
// here with an X-Webhook-Secret header; this route normalizes the payload, runs the local
// reminder/pipeline engine, and forwards the typed event to the nurture engine.
//
// Mirrors functions/api/appointment-webhook.js (the Pages twin, which becomes the ingest
// point at/after the Pages push — both are idempotent, so running both later is safe):
//   secret chain GHL_APPOINTMENT_WEBHOOK_SECRET || GHL_WEBHOOK_SECRET, constant-time compare,
//   fail closed when unset, 401 before any state change, never a 5xx retry storm.
//
// gx02's "capture one real payload" is built in: unrecognized payloads, and recognized ones
// missing key fields (contact/calendar/appointment/start), are stored RAW on automation_events
// so the normalizer's alias lists can be corrected from real JSON. PII posture: keep-always
// (Eben, 2026-07-12).

import { verifyGhlWebhookSecret } from "../../functions/lib/ghl-webhook-auth.js";
import { normalizeAppointmentEvent } from "../../functions/lib/appointment-event.js";
import { forwardEventToEngine } from "../../functions/lib/engine-forward.js";
import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { handleEvent } from "./engine.js";
import { appendEvent } from "./store.js";
import { captureFollowUpReliability } from "./follow-up-reliability.js";
import { captureNoShowCounterShadow, MISSED_APPOINTMENTS_FIELD } from "./no-show-counter-shadow.js";
import { publishedWorkflow } from "./workflow-store.js";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const FOLLOW_UP_CALENDAR_IDS = new Set([
  "ZO1jlGfy01rsxVqicoSB", "SKDVOL8wtUN6Ne0ppbC9", "oVn77FcecFY16iS2pHyP", "B5aGXLoS4kzAjZAMMXxk",
  "bJFkhVP35Ecwh4tLnSmy", "wO5lnu7BOQOHEJ5YQU0f", "waHmG2mHNThPfMVuNJWG",
]);
const NO_SHOW_RECOVERY_CALENDAR_IDS = new Set([
  "bJFkhVP35Ecwh4tLnSmy", "G7OAnnJuFbMF6nQSlZVQ", "B5aGXLoS4kzAjZAMMXxk", "SKDVOL8wtUN6Ne0ppbC9",
  "ZO1jlGfy01rsxVqicoSB", "lfsnaiGiLNL2z12pLKDP", "oVn77FcecFY16iS2pHyP", "ySmht5hx4uZGEpgZrlCw",
  "P7T6M1w8wtuRfwAqzOVw", "wO5lnu7BOQOHEJ5YQU0f", "waHmG2mHNThPfMVuNJWG",
]);
const REMINDER_PREFERENCE_FIELD = "a42sQtjQ2yZPd0eJmkGW";

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const RAW_CAPTURE_LIMIT = 4000; // keep D1 rows sane; a webhook body is far smaller in practice

function captureDetail(body) {
  const raw = JSON.stringify(body);
  return raw.length > RAW_CAPTURE_LIMIT
    ? { raw_truncated: raw.slice(0, RAW_CAPTURE_LIMIT) }
    : { raw: body };
}

function isDeficient(event) {
  return !event.recognized || !event.contactId || !event.calendarId || !event.startAt;
}

// The shared GHL bridge deliberately carries the stable appointment identifiers and status,
// but not GHL's separate trigger-level Event Type. Follow-Up accepts Normal appointments only.
// Read the canonical appointment record before letting that shadow flow evaluate the event,
// rather than treating an absent kind as Normal. This stays narrowly scoped to Follow-Up;
// every other flow continues to use the bridge payload without an extra API read.
function needsCanonicalEventType(event) {
  return (FOLLOW_UP_CALENDAR_IDS.has(event.calendarId) || NO_SHOW_RECOVERY_CALENDAR_IDS.has(event.calendarId))
    && !event.appointmentEventType;
}

/**
 * The 2026-07-12 first-live-payload finding: GHL's webhook merge tags reliably carry the
 * CONTACT and APPOINTMENT ids, but calendar/status arrive as the literal string "null" and
 * start_time as human prose. So when a payload is deficient, look the appointment up in the
 * GHL API (read-only — shadow-safe) and rebuild the typed event from canonical data. The API
 * response is re-run through the same normalizer (its appointment.* aliases match).
 */
async function enrichFromApi(env, event, nowMs) {
  const token = await getAccessToken(env);
  const res = await fetch(`${GHL_API_BASE}/calendars/events/appointments/${event.appointmentId}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (!res.ok) throw new Error(`appointment lookup ${res.status}`);
  const data = await res.json();
  const appt = data.appointment || data.event || data;
  const enriched = normalizeAppointmentEvent({ appointment: appt });
  const calendarId = enriched.calendarId || event.calendarId;
  // GHL's canonical appointment API does not expose the workflow trigger's Event Type.
  // Eben approved its exact `isRecurring:false` field as the Follow-Up-only equivalent of
  // Event Type = Normal. Map only the literal false value on an owned Follow-Up calendar;
  // true, absent, or malformed values remain fail-closed, and every other flow is untouched.
  const appointmentEventType = enriched.appointmentEventType
    || event.appointmentEventType
    || ((FOLLOW_UP_CALENDAR_IDS.has(calendarId) || NO_SHOW_RECOVERY_CALENDAR_IDS.has(calendarId)) && enriched.isRecurring === false ? "normal" : null);
  return {
    ...enriched,
    // the webhook payload's ids are reliable — keep them when the API omits either
    contactId: enriched.contactId || event.contactId,
    appointmentId: enriched.appointmentId || event.appointmentId,
    calendarId,
    startAt: enriched.startAt || event.startAt,
    modifiedBy: enriched.modifiedBy ?? event.modifiedBy,
    appointmentEventType,
  };
}

function fieldValue(contact, fieldId) {
  const fields = contact?.customFields || contact?.custom_fields || [];
  if (!Array.isArray(fields)) return "";
  const field = fields.find((item) => item?.id === fieldId || item?.key === "contact.reminder_preference");
  return String(field?.value ?? field?.fieldValue ?? field?.field_value ?? "").trim().toLowerCase();
}

function numericFieldValue(contact, field) {
  const fields = contact?.customFields || contact?.custom_fields || [];
  if (!Array.isArray(fields)) return null;
  const match = fields.find((item) => item?.id === field.id || item?.key === field.key);
  const raw = match?.value ?? match?.fieldValue ?? match?.field_value;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// GHL supplies the appointment event during the transition, but the Worker records the branch
// choice with the enrollment. A later copy edit therefore changes the pending owned node, not a
// hidden GHL branch. Empty/unknown matches the live workflow's full-reminder fallback.
async function enrichFollowUpPreference(env, event) {
  if (event.type !== "confirmed" || !FOLLOW_UP_CALENDAR_IDS.has(event.calendarId) || !event.contactId) {
    return event;
  }
  const token = await getAccessToken(env);
  const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(event.contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (!res.ok) throw new Error(`follow-up preference lookup ${res.status}`);
  const raw = fieldValue((await res.json()).contact || {}, REMINDER_PREFERENCE_FIELD);
  const reminderPreference = raw === "none" || raw === "some" ? raw : "full";
  return { ...event, context: { ...(event.context || {}), reminderPreference } };
}

export async function enrichNoShowAffiliateStatus(env, event) {
  if (event.type !== "noshow" || !NO_SHOW_RECOVERY_CALENDAR_IDS.has(event.calendarId) || !event.contactId) return event;
  const token = await getAccessToken(env);
  const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(event.contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (!res.ok) throw new Error(`no-show affiliate lookup ${res.status}`);
  const contact = (await res.json()).contact || {};
  const tags = Array.isArray(contact.tags) ? contact.tags.map((tag) => String(tag).trim().toLowerCase()) : [];
  return {
    ...event,
    context: {
      ...(event.context || {}),
      affiliatePartner: tags.includes("affiliate-partner") ? "true" : "false",
      // This is an ingest-time observation, not proof of whether GHL's separate live Math
      // Operation has already executed for this event.
      missedAppointmentsObserved: numericFieldValue(contact, MISSED_APPOINTMENTS_FIELD),
    },
  };
}

export async function handleWebhook(request, env, nowMs) {
  const provided = request.headers.get("X-Webhook-Secret") || "";
  const auth = verifyGhlWebhookSecret(env, provided, "GHL_APPOINTMENT_WEBHOOK_SECRET");
  if (!auth.configured) return json(503, { error: "webhook secret not configured" });
  if (!auth.valid) return json(401, { error: "unauthorized" });

  let body;
  let rawBody;
  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const db = env.REMINDER_DB;
  let event = normalizeAppointmentEvent(body);

  // A deficient bridge payload, or a Follow-Up event missing its required Event Type, with a
  // usable appointment id → rebuild from GHL's canonical record. Both paths are read-only.
  if ((isDeficient(event) || needsCanonicalEventType(event)) && event.appointmentId && env.PORTAL_KV) {
    try {
      const enriched = await enrichFromApi(env, event, nowMs);
      await appendEvent(db, {
        ts: nowMs, engine: "ingest", contactId: enriched.contactId, appointmentId: enriched.appointmentId,
        action: "ingest_enriched", outcome: "enriched",
        detail: { ...captureDetail(body), enriched },
      });
      event = enriched;
    } catch (err) {
      await appendEvent(db, {
        ts: nowMs, engine: "ingest", contactId: event.contactId, appointmentId: event.appointmentId,
        action: "ingest_deficient", outcome: "captured",
        detail: { ...captureDetail(body), normalized: event, enrichError: String((err && err.message) || err) },
      });
    }
  }

  if (!event.recognized) {
    await appendEvent(db, {
      ts: nowMs, engine: "ingest", action: "ingest_unrecognized", outcome: "skipped",
      detail: captureDetail(body),
    });
    return json(200, { success: true, skipped: "unrecognized" });
  }

  try {
    event = await enrichFollowUpPreference(env, event);
  } catch (err) {
    // Preserve the GHL fallback semantics in shadow mode while keeping the source-read failure
    // visible in owned evidence. This never sends or changes GHL.
    event = { ...event, context: { ...(event.context || {}), reminderPreference: "full" } };
    await appendEvent(db, {
      ts: nowMs, engine: "ingest", flowKey: "follow-up-session-reminders", contactId: event.contactId, appointmentId: event.appointmentId,
      action: "follow_up_preference_lookup", outcome: "fallback", detail: { error: String((err && err.message) || err) },
    });
  }

  try {
    event = await enrichNoShowAffiliateStatus(env, event);
  } catch (err) {
    // Unknown is intentionally not a valid branch value. The workflow can record an
    // enrollment but creates zero pending message steps until the contact is readable.
    event = { ...event, context: { ...(event.context || {}), affiliatePartner: "unknown" } };
    await appendEvent(db, {
      ts: nowMs, engine: "ingest", flowKey: "no-show-recovery", contactId: event.contactId, appointmentId: event.appointmentId,
      action: "no_show_affiliate_lookup", outcome: "blocked", detail: { error: String((err && err.message) || err) },
    });
  }

  // Still missing a field the engines key on (and enrichment unavailable/failed) → capture
  // for alias debugging, then still dispatch (the engines no-op safely on nulls).
  if (!event.contactId || !event.calendarId || !event.startAt) {
    await appendEvent(db, {
      ts: nowMs, engine: "ingest", contactId: event.contactId, appointmentId: event.appointmentId,
      action: "ingest_deficient", outcome: "captured",
      detail: { ...captureDetail(body), normalized: event },
    });
  }

  const actions = [];
  const errors = [];

  // Shadow evidence is deliberately non-blocking: the retained GHL Math Operation stays live
  // until a separately approved cutover, while owned truth is derived from immutable CRM
  // appointment revisions. A capture failure remains visible without retrying the webhook or
  // risking a duplicate legacy increment.
  let noShowCounterReliability = { enabled: false, applicable: false };
  try {
    noShowCounterReliability = await captureNoShowCounterShadow({ env, event, rawPayload: rawBody, nowMs });
  } catch (err) {
    await appendEvent(db, {
      ts: nowMs, engine: "ingest", flowKey: "no-show-missed-count", contactId: event.contactId, appointmentId: event.appointmentId,
      action: "no_show_counter_shadow_capture", outcome: "blocked", detail: { error: String((err && err.message) || err) },
    });
    errors.push("no-show counter shadow: capture unavailable");
  }

  // The import is inert unless the exact feature flag is enabled. In enabled mode, an
  // applicable Follow-Up event must be durably accepted or explicitly rejected before the
  // existing engine dispatches it. A reliability outage returns retryable failure and cannot
  // fall through to the legacy enrollment path.
  let reliability;
  let reliabilityWorkflow = null;
  try {
    const reliabilityEnabled = env.FOLLOW_UP_RELIABILITY_SPINE_ENABLED === "enabled";
    const reliabilityCandidate = reliabilityEnabled && FOLLOW_UP_CALENDAR_IDS.has(event.calendarId);
    if (reliabilityCandidate) {
      reliabilityWorkflow = await publishedWorkflow(db, FOLLOW_UP_WORKFLOW.id);
      reliability = await captureFollowUpReliability({
        env, event, rawPayload: rawBody, nowMs, workflow: reliabilityWorkflow,
      });
    } else {
      reliability = { enabled: reliabilityEnabled, applicable: false };
    }
  } catch {
    return json(503, { error: "Follow-Up reliability receipt unavailable", retryable: true });
  }
  try {
    const local = await handleEvent(env, event, nowMs, {
      workflowOverrides: reliability.accepted ? [reliabilityWorkflow] : [],
    });
    actions.push(...local.actions);
  } catch (err) {
    if (reliability.accepted) {
      return json(503, {
        error: "Follow-Up reliability dispatch failed",
        retryable: true,
        sourceEventId: reliability.sourceEvent?.source_event_id,
      });
    }
    errors.push(`reminder: ${String((err && err.message) || err)}`);
  }

  const fwd = await forwardEventToEngine(env, {
    urlVar: "NURTURE_ENGINE_URL",
    event,
    // Worker→worker must ride the service binding (same-account workers.dev fetches are blocked).
    fetcher: env.NURTURE ? env.NURTURE.fetch.bind(env.NURTURE) : undefined,
  });
  if (fwd.ok && !fwd.skipped) actions.push(...(fwd.actions || []));
  if (!fwd.ok) errors.push(`nurture: ${fwd.error}`);

  // Always 200 once authenticated, parsed, and durably classified: an ineligible Follow-Up
  // status is an accepted transport receipt, not a failed delivery. Its explicit reliability
  // rejection prevents enrollment while the existing dispatch still handles cancellation,
  // no-show, and other lifecycle routing. Only a persistence outage above remains retryable.
  return json(200, {
    success: true, actions, errors,
    ...(reliability.applicable ? {
      reliability: {
        sourceEventId: reliability.sourceEvent?.source_event_id || reliability.sourceEventId,
        ...(reliability.accepted ? {
          lifecycleInstanceId: reliability.lifecycle?.lifecycle_instance_id,
        } : {
          rejected: true,
          exceptionId: reliability.exceptionId,
        }),
        deduplicated: reliability.deduplicated,
      },
    } : {}),
    ...(noShowCounterReliability.applicable ? {
      noShowCounterReliability: {
        sourceEventId: noShowCounterReliability.sourceEvent?.source_event_id || noShowCounterReliability.sourceEventId,
        ...(noShowCounterReliability.accepted ? {
          lifecycleInstanceId: noShowCounterReliability.lifecycle?.lifecycle_instance_id,
          shadowOnly: true,
        } : {
          rejected: true,
          exceptionId: noShowCounterReliability.exceptionId,
        }),
        deduplicated: noShowCounterReliability.deduplicated,
      },
    } : {}),
  });
}
