import { defineWorkflow, executableFlow } from "./workflow-definition.js";

// Source verified from the published GHL workflow
// "In-Person Partner Session: Confirmation & Reminder Flow". The document is
// intentionally hard-shadow: the former workflow's No Show-series exit and an
// owned SMS provider are not yet replaceable. Signed owned client management
// links are now source-complete, but cannot weaken either remaining gate.
// defineWorkflow refuses to accept an active document while any source gap is
// present, so environment variables cannot silently turn this into a sender.
export const PARTNER_INITIAL_IN_PERSON_WORKFLOW = defineWorkflow({
  id: "partner-initial-in-person",
  name: "In-Person Partner Session: Confirmation & Reminder Flow",
  version: 3,
  executionMode: "shadow",
  sourceGaps: [
    "no_show_series_exit_not_owned",
    "owned_sms_provider_unselected",
  ],
  trigger: {
    event: "appointment_status_changed",
    calendarIds: ["lfsnaiGiLNL2z12pLKDP"],
    serviceIds: ["partner-initial"],
    statuses: ["confirmed"],
    modifiedBy: null,
  },
  exits: [{ event: "cancelled", effect: "cancel_pending", label: "Cancel every pending reminder" }],
  nodes: [
    {
      id: "booked-internal",
      label: "Notify Garrett by email",
      at: "enroll",
      action: { type: "internal_email", template: "booked-internal" },
      skipIfPast: false,
      message: {
        audience: "internal",
        channel: "email",
        subject: "{{firstName}} booked a {{calendarName}}",
        body: "Hi {{userFirstName}},\n\n{{contactName}} booked a {{calendarName}} for {{appointmentDate}} at {{appointmentTime}} {{appointmentTimezone}}\n\nStudio: 662 8th Ave, San Francisco, CA 94118",
      },
    },
    {
      id: "confirmation",
      label: "Send partner-session confirmation",
      at: "enroll",
      action: { type: "email", template: "confirmation" },
      skipIfPast: false,
      message: {
        audience: "client",
        channel: "email",
        from: "Amari Method <eben@amarimethod.com>",
        subject: "Your partner session is confirmed",
        preheader: "See you soon. Here are your session details.",
        body: "Hi {{firstName}},\n\nYour session with Garrett is confirmed:\n\n{{calendarName}}\n{{appointmentDate}} at {{appointmentTime}} {{appointmentTimezone}}\n662 8th Ave, San Francisco, CA 94118\n\nA few reminders:\n• 60-minute session\n• Wear comfortable clothes\n• Allow time for parking\n\nReschedule {{rescheduleLink}} · Cancel {{cancellationLink}}\n\nAdd to Google Calendar {{googleCalendarLink}} · Add to iCal/Outlook {{icalLink}}\n\nThe Amari Method Team",
      },
    },
    {
      id: "day-before",
      label: "Send day-before email",
      at: "start-1440m",
      action: { type: "email", template: "day-before" },
      skipIfPast: true,
      message: {
        audience: "client",
        channel: "email",
        from: "Amari Method <eben@amarimethod.com>",
        subject: "See you tomorrow, {{firstName}}",
        preheader: "Quick reminder about your session tomorrow.",
        body: "Hi {{firstName}},\n\nJust a heads up about your upcoming session with Garrett:\n\n{{calendarName}}\n{{appointmentDate}} at {{appointmentTime}} {{appointmentTimezone}}\n662 8th Ave, San Francisco, CA 94118\n\nIf something came up:\nReschedule {{rescheduleLink}} · Cancel {{cancellationLink}}\n\nThe Amari Method Team",
      },
    },
    {
      id: "starting-soon",
      label: "Send one-hour email",
      at: "start-60m",
      action: { type: "email", template: "starting-soon" },
      skipIfPast: true,
      message: {
        audience: "client",
        channel: "email",
        from: "Amari Method <eben@amarimethod.com>",
        subject: "Your session is in 1 hour",
        preheader: "See you soon.",
        body: "Hi {{firstName}},\n\nYour session with Garrett is at {{appointmentTime}} {{appointmentTimezone}}.\n\n662 8th Ave, San Francisco, CA 94118\n\nThe Amari Method Team",
      },
    },
    {
      id: "one-hour-sms",
      label: "Send one-hour SMS",
      at: "start-60m",
      action: { type: "sms", template: "one-hour-sms" },
      skipIfPast: true,
      message: {
        audience: "client",
        channel: "sms",
        body: "Hi {{firstName}}, just a friendly reminder that your appointment with Garrett is in one hour.",
      },
    },
    {
      id: "one-hour-internal",
      label: "Notify Garrett by SMS",
      at: "start-60m",
      action: { type: "internal_sms", template: "one-hour-internal" },
      skipIfPast: true,
      message: {
        audience: "internal",
        channel: "sms",
        body: "{{contactName}}'s {{calendarName}} appointment at {{appointmentTime}} {{appointmentTimezone}}. These were the specific issues this person wanted to address (if applicable): {{additionalInformation}}",
      },
    },
  ],
});

export const PARTNER_INITIAL_IN_PERSON = executableFlow(PARTNER_INITIAL_IN_PERSON_WORKFLOW);

export function partnerInitialInPersonNode(template, workflow = PARTNER_INITIAL_IN_PERSON_WORKFLOW) {
  return workflow.nodes.find((candidate) => candidate.action.template === template) || null;
}
