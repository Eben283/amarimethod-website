import { defineWorkflow, executableFlow } from "./workflow-definition.js";

// Source verified from the live GHL workflow "Initial -Virtual Session Welcome /
// reminder email flow" on 2026-08-07. This document is intentionally a separate
// scope within the Initial-session reminders family: Initial Virtual only.
export const INITIAL_VIRTUAL_WORKFLOW = defineWorkflow({
  id: "initial-virtual",
  name: "Initial Session — Virtual",
  version: 4,
  executionMode: "shadow",
  trigger: {
    event: "appointment_status_changed",
    calendarIds: ["ySmht5hx4uZGEpgZrlCw"],
    statuses: ["confirmed"],
    modifiedBy: ["user", "customer"],
    // The shared Appointment Events Webhook omits the actor merge field for this
    // calendar. Keep the documented GHL trigger contract above, but accept the
    // enriched null actor only inside the exact Initial Virtual calendar boundary.
    modifiedByByCalendar: { ySmht5hx4uZGEpgZrlCw: null },
  },
  exits: [{ event: "cancelled", effect: "cancel_pending", label: "Cancel every pending reminder" }],
  nodes: [
    { id: "booked-internal", label: "Notify Garrett by email", at: "enroll", action: { type: "internal_email", template: "booked-internal" }, skipIfPast: false, message: { audience: "internal", channel: "email", subject: "{{contactName}} booked a {{calendarName}}", body: "Hi {{userFirstName}},\n\n{{contactName}} booked a {{calendarName}} for {{appointmentDate}} at {{appointmentTime}}.\nHow we'll connect: {{location}}" } },
    { id: "welcome", label: "Send virtual welcome", at: "enroll", action: { type: "email", template: "welcome" }, skipIfPast: false, message: { audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "You're booked, here's what to expect", body: "Hi {{firstName}},\n\nYou're confirmed for your first Amari Method session with Garrett. Here's everything you need.\n\nSession Details\nDate: {{appointmentDate}}\nTime: {{appointmentTime}}\nDuration: 60 minutes\n\nJoining Your Session\nWe use Google Meet. Your link: {{location}}. Please test your camera and mic beforehand. Find a quiet space with at least 6' x 6' of room to move.\n\nEquipment\nIt's most helpful to have everything below ready for your first session. We may not use it all today, that depends on what we focus on, but you'll use these as your practice continues.\nYoga block, required. We'll use it in the first session. → https://amzn.to/4kDykic\nHigh-density foam roller → https://amzn.to/4rjKlfk\nPull-up bar → https://amzn.to/3ZzXYel\nGymnastic rings → https://amzn.to/4aB3MsS\n\nWhat to Wear\nWear something comfortable you can move in.\n\n{{appointmentLinks}}\n\nThe Amari Method Team" } },
    { id: "reschedule-confirmation", label: "Send updated virtual booking confirmation", at: "reschedule", action: { type: "email", template: "reschedule-confirmation" }, skipIfPast: false, message: { audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "Your virtual appointment time has been updated", body: "Hi {{firstName}},\n\nYour virtual session with Garrett has been updated:\n{{calendarName}}\n{{appointmentFull}}\nGoogle Meet: {{location}}\n\n{{appointmentLinks}}\n\nWe look forward to seeing you.\nThe Amari Method Team" } },
    { id: "day-before", label: "Send day-before email", at: "start-1440m", action: { type: "email", template: "day-before" }, skipIfPast: true, message: { audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "See you tomorrow, {{firstName}}", body: "Hi {{firstName}},\n\nJust a heads up about your upcoming session:\n{{calendarName}}\n{{appointmentFull}}\nHow we'll connect: {{location}}\n\n{{appointmentLinks}}\n\nLooking forward to it.\nGarrett" } },
    { id: "one-hour-email", label: "Send one-hour email", at: "start-60m", action: { type: "email", template: "one-hour-email" }, skipIfPast: true, message: { audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session is in 1 hour", body: "Hi {{firstName}},\n\nYour session with Garrett is at {{appointmentTime}}.\nGoogle Meet: {{location}}\n\nA few things before we start:\n- Join 5 minutes early to test your connection.\n- Have your equipment ready: foam roller, yoga block, pull-up bar, gymnastic rings.\n- Find a quiet space with room to move (at least 6' x 6').\n- Wear comfortable clothes you can move in.\n\nIf you have trouble connecting, call us at (628) 877-7673.\n\nSee you soon.\nGarrett" } },
    { id: "one-hour-sms", label: "Send one-hour SMS", at: "start-60m", action: { type: "sms", template: "one-hour-sms" }, skipIfPast: true, message: { audience: "client", channel: "sms", body: "Hi {{firstName}}, just a friendly reminder. Your appointment with Garrett is at {{appointmentTime}}. Here is the link: {{location}}" } },
    { id: "one-hour-internal", label: "Notify Garrett by SMS", at: "start-60m", action: { type: "internal_sms", template: "one-hour-internal" }, skipIfPast: true, message: { audience: "internal", channel: "sms", body: "{{contactName}}'s {{calendarName}} appointment at {{appointmentTime}}. These were the specific issues this person wanted to address (if applicable): {{additionalInformation}} Here is the meeting link: {{location}}" } },
  ],
});

export const INITIAL_VIRTUAL = executableFlow(INITIAL_VIRTUAL_WORKFLOW);

export function initialVirtualNode(template, workflow = INITIAL_VIRTUAL_WORKFLOW) {
  const node = workflow.nodes.find((candidate) => candidate.action.template === template);
  if (!node && template === "reschedule-confirmation") {
    return INITIAL_VIRTUAL_WORKFLOW.nodes.find((candidate) => candidate.action.template === template) || null;
  }
  return node || null;
}
