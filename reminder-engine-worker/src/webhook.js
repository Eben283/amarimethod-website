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

import { timingSafeEqual } from "../../functions/lib/safe-equal.js";
import { normalizeAppointmentEvent } from "../../functions/lib/appointment-event.js";
import { forwardEventToEngine } from "../../functions/lib/engine-forward.js";
import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { handleEvent } from "./engine.js";
import { appendEvent } from "./store.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const FOLLOW_UP_CALENDAR_IDS = new Set([
  "ZO1jlGfy01rsxVqicoSB", "SKDVOL8wtUN6Ne0ppbC9", "oVn77FcecFY16iS2pHyP", "B5aGXLoS4kzAjZAMMXxk",
  "bJFkhVP35Ecwh4tLnSmy", "wO5lnu7BOQOHEJ5YQU0f", "waHmG2mHNThPfMVuNJWG",
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
  return {
    ...enriched,
    // the webhook payload's ids are reliable — keep them when the API omits either
    contactId: enriched.contactId || event.contactId,
    appointmentId: enriched.appointmentId || event.appointmentId,
    modifiedBy: enriched.modifiedBy ?? event.modifiedBy,
  };
}

function fieldValue(contact, fieldId) {
  const fields = contact?.customFields || contact?.custom_fields || [];
  if (!Array.isArray(fields)) return "";
  const field = fields.find((item) => item?.id === fieldId || item?.key === "contact.reminder_preference");
  return String(field?.value ?? field?.fieldValue ?? field?.field_value ?? "").trim().toLowerCase();
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

export async function handleWebhook(request, env, nowMs) {
  const expected = env.GHL_APPOINTMENT_WEBHOOK_SECRET || env.GHL_WEBHOOK_SECRET;
  if (!expected) return json(503, { error: "webhook secret not configured" });

  const provided = request.headers.get("X-Webhook-Secret") || "";
  if (!timingSafeEqual(provided, expected)) return json(401, { error: "unauthorized" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const db = env.REMINDER_DB;
  let event = normalizeAppointmentEvent(body);

  // Deficient payload with a usable appointment id → rebuild from the GHL API.
  if (isDeficient(event) && event.appointmentId && env.PORTAL_KV) {
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

  try {
    const local = await handleEvent(env, event, nowMs);
    actions.push(...local.actions);
  } catch (err) {
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

  // Always 200 once authenticated + parsed: a consumer hiccup must not become a GHL
  // retry storm; failures are visible on the errors list + automation_events.
  return json(200, { success: true, actions, errors });
}
