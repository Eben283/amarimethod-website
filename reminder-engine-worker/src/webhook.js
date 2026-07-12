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
import { handleEvent } from "./engine.js";
import { appendEvent } from "./store.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const RAW_CAPTURE_LIMIT = 4000; // keep D1 rows sane; a webhook body is far smaller in practice

function captureDetail(body) {
  const raw = JSON.stringify(body);
  return raw.length > RAW_CAPTURE_LIMIT
    ? { raw_truncated: raw.slice(0, RAW_CAPTURE_LIMIT) }
    : { raw: body };
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
  const event = normalizeAppointmentEvent(body);

  if (!event.recognized) {
    await appendEvent(db, {
      ts: nowMs, engine: "ingest", action: "ingest_unrecognized", outcome: "skipped",
      detail: captureDetail(body),
    });
    return json(200, { success: true, skipped: "unrecognized" });
  }

  // Recognized but missing a field the engines key on → capture for alias debugging, then
  // still dispatch (the engines no-op safely on nulls).
  if (!event.contactId || !event.calendarId || !event.appointmentId || !event.startAt) {
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
