// Appointment-event dispatch seam — reminder-engine migration substrate (brick 3).
//
// The endpoint (functions/api/appointment-webhook.js) hands every RECOGNIZED typed appointment
// event to this one function, which forwards it to the engine workers' POST /event routes:
//   - reminder-engine: enrollOn/cancelOn per flow config (+ the pipeline helper riding it)
//   - nurture-engine:  entry (showed) + exits (booked/confirmed) per sequence config
// Consumers are added HERE, never in the endpoint. Until the worker URLs
// (REMINDER_ENGINE_URL / NURTURE_ENGINE_URL) + WORKER_AUTH_SECRET exist in the Pages env,
// each forward is a clean skip — the plumbing ships dormant and lights up at deploy.
//
// Contract: never throws; consumer failures go in `errors[]` with `ok:false` (a broken consumer
// must never turn a successful ingest into a webhook retry storm). Never mutates `event` or
// `context`. Returns a fresh object (with fresh arrays) per call. No console.*.
//
// event shape (from normalizeAppointmentEvent, do not redefine):
//   { type, recognized, status, calendarId, contactId, appointmentId, startAt, modifiedBy }
//   type ∈ booked|confirmed|cancelled|showed|noshow  (endpoint only dispatches recognized events)
// DispatchAction: { engine: string, action: string, detail?: object }

import { forwardEventToEngine } from "./engine-forward.js";

const CONSUMERS = [
  { name: "reminder", urlVar: "REMINDER_ENGINE_URL" },
  { name: "nurture", urlVar: "NURTURE_ENGINE_URL" },
];

export async function dispatchAppointmentEvent(context, event) {
  const actions = [];
  const errors = [];

  const env = context && context.env;
  if (env && event && event.recognized === true) {
    for (const consumer of CONSUMERS) {
      try {
        const res = await forwardEventToEngine(env, { urlVar: consumer.urlVar, event });
        if (res.skipped) continue; // unconfigured pre-deploy — dormant, not an error
        if (res.ok) {
          actions.push(...(res.actions || []));
        } else {
          errors.push(`${consumer.name}: ${res.error}`);
        }
      } catch (err) {
        errors.push(`${consumer.name}: ${String((err && err.message) || err)}`);
      }
    }
  }

  return { ok: errors.length === 0, actions, errors };
}
