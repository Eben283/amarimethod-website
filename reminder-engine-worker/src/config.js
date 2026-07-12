// Reminder/confirmation engine — flow configuration.
//
// One frozen FLOW entry per lifecycle flow. The engine executes these; the dashboard draws diagrams
// from them (correct by construction). Copy templates live in ./templates/<flowKey>.js (not yet
// created — the engine references template keys, resolution is a later brick).
//
// Canonical shape (from session-ops-reminder-engine.md):
//   flowKey      stable id; namespaces enrollments + the automation_events log + idempotency
//   calendarIds  one or more GHL calendars that enroll into this flow
//   enrollOn     { statuses: [...typed event types], modifiedBy: null | [...]}  — the trigger filter
//   cancelOn     [...typed event types] that cancel all pending steps
//   mode         "shadow" | "active" — shadow computes + logs would_send, never sends; DEFAULT shadow
//                so a new flow always runs beside GHL until deliberately switched on
//   steps        ordered; `at` is relative to appointment start:
//                  "enroll"        → send immediately on enrollment
//                  "start-<n>m"    → n minutes before appointment start
//                  "start+<n>m"    → n minutes after appointment start
//                skipIfPast: true  → if the computed time is already past at enroll, skip (don't backfire)

export const INITIAL_IN_PERSON = Object.freeze({
  flowKey: "initial-in-person",
  calendarIds: Object.freeze(["G7OAnnJuFbMF6nQSlZVQ"]), // Initial Session In-Person
  enrollOn: Object.freeze({ statuses: Object.freeze(["booked", "confirmed"]), modifiedBy: null }),
  cancelOn: Object.freeze(["cancelled"]),
  mode: "shadow",
  steps: Object.freeze([
    { at: "enroll", type: "internal_email", template: "booked-internal", skipIfPast: false },
    { at: "enroll", type: "email", template: "confirmation", skipIfPast: false },
    { at: "start-1440m", type: "email", template: "day-before", skipIfPast: true },
    { at: "start-60m", type: "sms", template: "one-hour-sms", skipIfPast: true },
    { at: "start-60m", type: "email", template: "starting-soon", skipIfPast: true },
    { at: "start-60m", type: "internal_sms", template: "one-hour-internal", skipIfPast: true },
    { at: "start+5m", type: "email", template: "equipment-list", skipIfPast: false },
  ]),
});

// Registry the engine iterates to find the flow(s) a calendar enrolls into.
export const FLOWS = Object.freeze([INITIAL_IN_PERSON]);

export function flowsForCalendar(calendarId) {
  return FLOWS.filter((f) => f.calendarIds.includes(calendarId));
}
