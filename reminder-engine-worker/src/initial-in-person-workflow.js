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
    { id: "booked-internal", label: "Notify Garrett by email", at: "enroll", action: { type: "internal_email", template: "booked-internal" }, skipIfPast: false, message: { audience: "internal", channel: "email", subject: "{{firstName}} booked a {{calendarName}}", body: "Hi, Big Dog,\n\n{{contactName}} booked a {{calendarName}} for {{appointmentDate}} at {{appointmentTime}}.\nStudio: {{location}}" } },
    { id: "confirmation", label: "Send booking confirmation", at: "enroll", action: { type: "email", template: "confirmation" }, skipIfPast: false, message: { audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "You're booked — here's what to expect", body: "Hi {{firstName}},\n\nYour session with Garrett is confirmed:\n{{calendarName}}\n{{appointmentFull}}\n{{location}}\n\nWear something comfortable you can move in. That's all you need.\n\n{{appointmentLinks}}\n\nWe look forward to seeing you.\nThe Amari Method Team" } },
    { id: "day-before", label: "Send day-before email", at: "start-1440m", action: { type: "email", template: "day-before" }, skipIfPast: true, message: { audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session on {{appointmentFull}}", body: "Hi {{firstName}},\n\nJust a heads up about your upcoming session:\n{{calendarName}}\n{{appointmentFull}}\n{{location}}\n\n{{appointmentLinks}}\n\nLooking forward to it.\nGarrett" } },
    { id: "one-hour-sms", label: "Send one-hour SMS", at: "start-60m", action: { type: "sms", template: "one-hour-sms" }, skipIfPast: true, message: { audience: "client", channel: "sms", body: "Hi {{firstName}}, just a friendly reminder — your appointment with Garrett is at {{appointmentTime}}. {{location}}" } },
    { id: "starting-soon", label: "Send one-hour email", at: "start-60m", action: { type: "email", template: "starting-soon" }, skipIfPast: true, message: { audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session at {{appointmentTime}}", body: "Hi {{firstName}},\n\nYour Amari Method session is at {{appointmentTime}}.\n{{location}}\n\nSee you soon.\nGarrett" } },
    { id: "one-hour-internal", label: "Notify Garrett by SMS", at: "start-60m", action: { type: "internal_sms", template: "one-hour-internal" }, skipIfPast: true, message: { audience: "internal", channel: "sms", body: "{{contactName}}'s {{calendarName}} appointment at {{appointmentTime}}. These were the specific issues this person wanted to address (if applicable): {{additionalInformation}}" } },
  ],
});

export const INITIAL_IN_PERSON = executableFlow(INITIAL_IN_PERSON_WORKFLOW);

export function initialInPersonNode(template, workflow = INITIAL_IN_PERSON_WORKFLOW) {
  return workflow.nodes.find((node) => node.action.template === template) || null;
}
