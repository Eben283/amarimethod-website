// Canonical executable definition for the live Morning SMS Worker.
// The Worker validates and executes these handler IDs, and Staff renders this same
// object. There is deliberately no second hand-drawn Morning SMS route.

import {
  AGENDA_COPY,
  COPY,
  DEFAULT_FIRST_MINUTES,
  PREP_LEAD_MS,
  SECOND_OFFSET_MS,
  SEND_GRACE_MS,
} from "./schedule.js";
import { defineMorningSmsWorkflow } from "./workflow-definition.js";

export const MORNING_SMS_DEFINITION = Object.freeze(defineMorningSmsWorkflow({
  id: "morning-sms:daily-staff-brief",
  engine: "morning-sms",
  key: "daily-staff-brief",
  name: "Morning SMS to Eben and Garrett",
  definitionVersion: 4,
  mode: "active",
  authority: "executable_definition",
  trigger: Object.freeze({
    cron: "*/5 11-19 * * MON-SAT",
    timeZone: "America/Los_Angeles",
    defaultFirstMinutes: DEFAULT_FIRST_MINUTES,
    earlyAppointmentLeadMs: PREP_LEAD_MS,
    sendGraceMs: SEND_GRACE_MS,
  }),
  agendaCopy: AGENDA_COPY,
  exits: Object.freeze([
    Object.freeze({ event: "nothing_due", effect: "no_send" }),
    Object.freeze({ event: "recipient_already_sent", effect: "skip_exact_date_kind_recipient" }),
  ]),
  steps: Object.freeze([
    Object.freeze({ id: "morning-cron", parentId: null, stepIndex: 0, type: "trigger", handler: "scheduled_event", owner: "cloudflare", label: "Cloudflare starts one scheduled check", at: "Every five minutes during the configured morning window" }),
    Object.freeze({ id: "morning-calendar-read", parentId: "morning-cron", stepIndex: 1, type: "read", handler: "read_todays_appointments", owner: "amari", provider: "ghl", label: "Read today's active appointments", source: "all GHL calendars" }),
    Object.freeze({ id: "morning-last-session", parentId: "morning-calendar-read", stepIndex: 2, type: "reconcile", handler: "identify_last_package_session", owner: "amari", label: "Identify names and evidence-backed sales opportunities", confidence: "high_or_manual_lock_only", result: "SELL cues" }),
    Object.freeze({ id: "morning-schedule", parentId: "morning-last-session", stepIndex: 3, type: "schedule", handler: "calculate_due_times", owner: "amari", label: "Decide what is due in this check", at: "Agenda at 08:00 PT or two hours before an earlier first appointment; meeting text 90 minutes later", afterMs: SECOND_OFFSET_MS }),
    Object.freeze({ id: "morning-agenda", parentId: "morning-schedule", stepIndex: 4, type: "compose", handler: "compose_agenda", owner: "amari", label: "Build today's appointment agenda when a text is due", failureCopy: "Today's appointment list could not be loaded." }),
    Object.freeze({
      id: "morning-send-agenda",
      parentId: "morning-agenda",
      stepIndex: 5,
      type: "sms",
      handler: "send_due_sms",
      messageKind: "prepare",
      owner: "amari",
      provider: "ghl",
      audience: "Eben and Garrett",
      label: "If the agenda is due, send it once per recipient",
      copy: "{{agenda}}",
      logic: Object.freeze([
        "Read every active appointment from every GHL calendar and sort the complete day by start time.",
        "Build one Pacific-time line with the client name only; resolve a missing event name from that contact record when available.",
        "Append SELL: FIRST / ONLY APPOINTMENT only when contact history proves it is an initial or Assessment appointment and the contact has exactly one active appointment.",
        "Append SELL: SECOND-TO-LAST STUDY SESSION only when the study counter or completed study history proves one completed session.",
        "Append SELL: LAST PACKAGE SESSION only when the owned package ledger proves it with high confidence or a manual lock.",
        "Send the completed agenda separately to Eben and Garrett.",
        "Skip a recipient when date + prepare + recipient was already recorded.",
      ]),
      idempotency: "date + prepare + recipient",
    }),
    Object.freeze({ id: "morning-send-meeting", parentId: "morning-agenda", stepIndex: 6, type: "sms", handler: "send_due_sms", messageKind: "meeting", owner: "amari", provider: "ghl", audience: "Eben and Garrett", label: "If the meeting text is due, send it once per recipient", copy: COPY.meeting, idempotency: "date + meeting + recipient" }),
    Object.freeze({ id: "morning-run-evidence", parentId: "morning-schedule", stepIndex: 7, type: "record", handler: "record_run_result", owner: "amari", label: "Record this scheduled check", target: "ops last-run evidence" }),
  ]),
  source: Object.freeze({
    kind: "owned_code",
    path: "morning-sms-worker/src/config.js",
  }),
}));
