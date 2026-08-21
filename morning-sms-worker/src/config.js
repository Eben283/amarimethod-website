// Provider-neutral source definition for the live Morning SMS Worker.
// Staff imports this object to draw the actual owned path; the Worker code remains
// the execution authority for scheduling, enrichment, idempotency, and delivery.

import {
  COPY,
  DEFAULT_FIRST_MINUTES,
  PREP_LEAD_MS,
  SECOND_OFFSET_MS,
  SEND_GRACE_MS,
} from "./schedule.js";

export const MORNING_SMS_DEFINITION = Object.freeze({
  id: "morning-sms:daily-staff-brief",
  engine: "morning-sms",
  key: "daily-staff-brief",
  name: "Morning SMS to Eben and Garrett",
  definitionVersion: 1,
  mode: "active",
  trigger: Object.freeze({
    cron: "*/5 11-19 * * MON-SAT",
    timeZone: "America/Los_Angeles",
    defaultFirstMinutes: DEFAULT_FIRST_MINUTES,
    earlyAppointmentLeadMs: PREP_LEAD_MS,
    sendGraceMs: SEND_GRACE_MS,
  }),
  exits: Object.freeze([
    Object.freeze({ event: "nothing_due", effect: "no_send" }),
    Object.freeze({ event: "recipient_already_sent", effect: "skip_exact_date_kind_recipient" }),
  ]),
  steps: Object.freeze([
    Object.freeze({ stepIndex: 0, type: "read", owner: "amari", provider: "ghl", label: "Read today's active appointments", source: "all GHL calendars" }),
    Object.freeze({ stepIndex: 1, type: "reconcile", owner: "amari", label: "Identify a package-ending appointment", confidence: "high_or_manual_lock_only", result: "LAST PACKAGE SESSION" }),
    Object.freeze({ stepIndex: 2, type: "schedule", owner: "amari", label: "Calculate prepare time", at: "08:00 PT or two hours before an earlier first appointment" }),
    Object.freeze({ stepIndex: 3, type: "compose", owner: "amari", label: "Build today's appointment agenda", failureCopy: "Today's appointment list could not be loaded." }),
    Object.freeze({ stepIndex: 4, type: "sms", owner: "amari", provider: "ghl", audience: "Eben and Garrett", label: "Send the morning agenda", copy: COPY.prepare, idempotency: "date + prepare + recipient" }),
    Object.freeze({ stepIndex: 5, type: "wait", owner: "amari", label: "Wait until the staff-meeting time", afterMs: SECOND_OFFSET_MS }),
    Object.freeze({ stepIndex: 6, type: "sms", owner: "amari", provider: "ghl", audience: "Eben and Garrett", label: "Send the staff-meeting text", copy: COPY.meeting, idempotency: "date + meeting + recipient" }),
    Object.freeze({ stepIndex: 7, type: "record", owner: "amari", label: "Record the run result", target: "ops last-run evidence" }),
  ]),
  source: Object.freeze({
    kind: "owned_code",
    path: "morning-sms-worker/src/config.js",
  }),
});
