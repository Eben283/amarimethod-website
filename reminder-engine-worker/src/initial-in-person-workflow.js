import { defineWorkflow, executableFlow } from "./workflow-definition.js";

export const INITIAL_IN_PERSON_WORKFLOW = defineWorkflow({
  id: "initial-in-person",
  name: "Initial / Assessment — In Person",
  version: 3,
  executionMode: "shadow",
  trigger: {
    event: "appointment_status_changed",
    calendarIds: ["G7OAnnJuFbMF6nQSlZVQ", "EM6vB2mq7EAdGCbUb3j1"],
    statuses: ["confirmed"],
    modifiedBy: ["user", "customer"],
    modifiedByByCalendar: { EM6vB2mq7EAdGCbUb3j1: null },
  },
  exits: [{ event: "cancelled", effect: "cancel_pending", label: "Cancel every pending reminder" }],
  nodes: [
    { id: "booked-internal", label: "Notify Garrett by email", at: "enroll", action: { type: "internal_email", template: "booked-internal" }, skipIfPast: false },
    { id: "confirmation", label: "Send booking confirmation", at: "enroll", action: { type: "email", template: "confirmation" }, skipIfPast: false },
    { id: "day-before", label: "Send day-before email", at: "start-1440m", action: { type: "email", template: "day-before" }, skipIfPast: true },
    { id: "one-hour-sms", label: "Send one-hour SMS", at: "start-60m", action: { type: "sms", template: "one-hour-sms" }, skipIfPast: true },
    { id: "starting-soon", label: "Send one-hour email", at: "start-60m", action: { type: "email", template: "starting-soon" }, skipIfPast: true },
    { id: "one-hour-internal", label: "Notify Garrett by SMS", at: "start-60m", action: { type: "internal_sms", template: "one-hour-internal" }, skipIfPast: true },
  ],
});

export const INITIAL_IN_PERSON = executableFlow(INITIAL_IN_PERSON_WORKFLOW);
