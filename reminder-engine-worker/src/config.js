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
//                  "enroll+<n>m"   → n minutes after the triggering event
//                  "start-<n>m"    → n minutes before appointment start
//                  "start+<n>m"    → n minutes after appointment start
//                skipIfPast: true  → if the computed time is already past at enroll, skip (don't backfire)

export { INITIAL_IN_PERSON } from "./initial-in-person-workflow.js";
import { INITIAL_IN_PERSON } from "./initial-in-person-workflow.js";

// Initial -Virtual Session Welcome / reminder email flow — virtual mirror of the in-person
// flow (twin: initial-virtual-session-welcome-reminder-email-flow.yaml, 95%, copy captured
// 2026-06-17 de-slopped; templates resolve at the active-mode brick).
export const INITIAL_VIRTUAL = Object.freeze({
  name: "Initial Session — Virtual",
  definitionVersion: 2,
  flowKey: "initial-virtual",
  calendarIds: Object.freeze(["ySmht5hx4uZGEpgZrlCw"]), // Initial Session - Virtual
  enrollOn: Object.freeze({ statuses: Object.freeze(["confirmed"]), modifiedBy: Object.freeze(["user", "customer"]) }),
  cancelOn: Object.freeze(["cancelled"]),
  mode: "shadow",
  steps: Object.freeze([
    { at: "enroll", type: "internal_email", template: "booked-internal", skipIfPast: false },
    { at: "enroll", type: "email", template: "welcome", skipIfPast: false },
    { at: "start-1440m", type: "email", template: "day-before", skipIfPast: true },
    { at: "start-60m", type: "email", template: "one-hour-email", skipIfPast: true },
    { at: "start-60m", type: "sms", template: "one-hour-sms", skipIfPast: true },
    { at: "start-60m", type: "internal_sms", template: "one-hour-internal", skipIfPast: true },
  ]),
});

// Discovery Call — Confirmation & Reminder Flow (twin: discovery-call-confirmation-reminder-
// flow.yaml, published, 3 calendars). GHL trigger is `confirmed` only — with auto-confirm that
// IS the booking moment (2026-07-12 calibration), so booked|confirmed both enroll.
export const DISCOVERY_CALL = Object.freeze({
  name: "Discovery Call — Confirmation & Reminder",
  definitionVersion: 1,
  flowKey: "discovery-call",
  calendarIds: Object.freeze([
    "USgPsktqRcuomdUgpShL", // Your Free Discovery Call
    "aVE54Qf4lrbYTB0zFqXy", // Ambassador Prospect Discovery Call
    "ZEIGFHBi17SpZ3Ezi5DR", // Discovery Call - Virtual
  ]),
  enrollOn: Object.freeze({ statuses: Object.freeze(["booked", "confirmed"]), modifiedBy: null }),
  cancelOn: Object.freeze(["cancelled"]),
  mode: "shadow",
  steps: Object.freeze([
    // step 1 is an internal SMS, not email — Eben verified live 2026-07-12 (twin was right)
    { at: "enroll", type: "internal_sms", template: "booked-internal", skipIfPast: false },
    { at: "enroll", type: "email", template: "confirmation", skipIfPast: false },
    { at: "start-1440m", type: "email", template: "day-before", skipIfPast: true },
    { at: "start-60m", type: "sms", template: "one-hour-sms", skipIfPast: true },
    { at: "start-60m", type: "internal_sms", template: "one-hour-internal", skipIfPast: true },
    { at: "start-15m", type: "sms", template: "fifteen-min-sms", skipIfPast: true },
    { at: "start-15m", type: "internal_sms", template: "fifteen-min-internal", skipIfPast: true },
  ]),
});

// In-Person Partner Session: Confirmation & Reminder Flow — a deliberately narrow first
// cutover slice. It stays shadow-only until its D1 run evidence matches the existing GHL
// workflow. GHL remains the calendar source and SMS transport during that proof period.
export const PARTNER_INITIAL_IN_PERSON = Object.freeze({
  name: "In-Person Partner Session: Confirmation & Reminder Flow",
  definitionVersion: 1,
  flowKey: "partner-initial-in-person",
  calendarIds: Object.freeze(["lfsnaiGiLNL2z12pLKDP"]), // In Person Session for Partners
  enrollOn: Object.freeze({ statuses: Object.freeze(["confirmed"]), modifiedBy: null }),
  cancelOn: Object.freeze(["cancelled"]),
  mode: "shadow",
  steps: Object.freeze([
    { at: "enroll", type: "internal_email", template: "booked-internal", skipIfPast: false },
    { at: "enroll", type: "email", template: "confirmation", skipIfPast: false },
    { at: "start-1440m", type: "email", template: "day-before", skipIfPast: true },
    { at: "start-60m", type: "email", template: "starting-soon", skipIfPast: true },
    { at: "start-60m", type: "sms", template: "one-hour-sms", skipIfPast: true },
    { at: "start-60m", type: "internal_sms", template: "one-hour-internal", skipIfPast: true },
  ]),
});

// No Show Email SMS series — Assessment-only owned replacement. The live GHL no-show workflow
// currently omits the public Assessment calendar, so this has no native behavior to shadow yet.
// It remains deliberately non-delivering while the complete Assessment lifecycle is proved.
export const ASSESSMENT_NO_SHOW = Object.freeze({
  name: "No Show Email SMS series — Assessment",
  definitionVersion: 1,
  flowKey: "assessment-no-show",
  calendarIds: Object.freeze(["EM6vB2mq7EAdGCbUb3j1"]),
  enrollOn: Object.freeze({ statuses: Object.freeze(["noshow"]), modifiedBy: null }),
  // A confirmed Assessment booking, whether it is a rescheduled original appointment or a new
  // booking, closes every active Assessment no-show enrollment for that contact.
  exitOn: Object.freeze(["confirmed"]),
  cancelOn: Object.freeze([]),
  mode: "shadow",
  steps: Object.freeze([
    { at: "enroll", type: "sms", template: "reschedule", skipIfPast: false },
    { at: "enroll+1440m", type: "email", template: "one-day-follow-up", skipIfPast: false },
    { at: "enroll+2880m", type: "email", template: "two-day-follow-up", skipIfPast: false },
  ]),
});

// Registry the engine iterates to find the flow(s) a calendar enrolls into.
// NOT yet configured (deliberately): follow-up confirmation (drives the `gate` feature — port
// LAST per the brief, and its Entrainment-calendar overlap with the draft entrainment flows
// must be resolved first), virtual partner session flows, post-session review request (needs the
// wait_for_link_click extension).
export const FLOWS = Object.freeze([INITIAL_IN_PERSON, INITIAL_VIRTUAL, DISCOVERY_CALL, PARTNER_INITIAL_IN_PERSON, ASSESSMENT_NO_SHOW]);

export function flowsForCalendar(calendarId) {
  return FLOWS.filter((f) => f.calendarIds.includes(calendarId));
}
