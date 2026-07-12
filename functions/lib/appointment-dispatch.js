// Appointment-event dispatch seam — reminder-engine migration substrate (brick 3).
//
// The endpoint (functions/api/appointment-webhook.js) hands every RECOGNIZED typed appointment
// event to this one function. Today it routes nowhere and returns an empty action list. Consumers
// are added HERE, never in the endpoint:
//   - reminder engine: on `booked`/`confirmed` → enroll; on `cancelled` → cancel pending timers
//     (per session-ops-reminder-engine.md enrollOn/cancelOn)
//   - nurture engine: entry + exit events
//   - pipeline helper: stage moves on booked/showed
// To add a consumer: call it, push its DispatchAction(s) onto `actions`, and catch its throw into
// `errors` (a broken consumer must never turn a successful ingest into a webhook retry storm).
//
// Contract: never throws; consumer failures go in `errors[]` with `ok:false`. Never mutates `event`
// or `context`. Returns a fresh object (with fresh arrays) per call. No console.*.
//
// event shape (from normalizeAppointmentEvent, do not redefine):
//   { type, recognized, status, calendarId, contactId, appointmentId, startAt, modifiedBy }
//   type ∈ booked|confirmed|cancelled|showed|noshow  (endpoint only dispatches recognized events)
// DispatchAction: { engine: string, action: string, detail?: object }

export async function dispatchAppointmentEvent(context, event) {
  const actions = [];
  const errors = [];

  // No consumers wired yet. Each future consumer runs inside its own try/catch:
  //   try { const done = await reminderEngine.onEvent(context, event); actions.push(...done); }
  //   catch (err) { errors.push(`reminder: ${err?.message || err}`); }

  return { ok: errors.length === 0, actions, errors };
}
