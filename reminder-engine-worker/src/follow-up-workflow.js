import { defineWorkflow, executableFlow } from "./workflow-definition.js";

// The literal Follow-Up workflow to be stored in D1 before it is ever enabled.
// GHL remains its sender until the shadow/reconciliation and activation gates are complete.
export const FOLLOW_UP_WORKFLOW = defineWorkflow({
  id: "follow-up-session-reminders",
  name: "Follow-up session reminders",
  version: 1,
  executionMode: "shadow",
  trigger: {
    event: "appointment_status_changed",
    calendarIds: [
      "ZO1jlGfy01rsxVqicoSB",
      "SKDVOL8wtUN6Ne0ppbC9",
      "oVn77FcecFY16iS2pHyP",
      "B5aGXLoS4kzAjZAMMXxk",
      "bJFkhVP35Ecwh4tLnSmy",
      "wO5lnu7BOQOHEJ5YQU0f",
      "waHmG2mHNThPfMVuNJWG",
    ],
    statuses: ["confirmed"],
    modifiedBy: ["user", "customer"],
  },
  exits: [{ event: "cancelled", effect: "cancel_pending", label: "Cancel every pending reminder" }],
  nodes: [
    {
      id: "remove-no-show-series",
      label: "Exit no-show recovery",
      at: "enroll",
      action: { type: "exit_flow", template: "remove-no-show-series", target: "assessment-no-show" },
      skipIfPast: false,
      message: { audience: "internal", channel: "email", body: "Control node: exit the owned no-show recovery enrollment. This is not a delivered message." },
    },
    {
      id: "booked-internal",
      label: "Notify Garrett by email",
      at: "enroll",
      action: { type: "internal_email", template: "booked-internal" },
      skipIfPast: false,
      message: {
        audience: "internal", channel: "email",
        subject: "{{firstName}} booked a {{calendarName}}",
        body: "Hey there big dog, {{contactName}} booked a {{calendarName}} for {{appointmentDate}} at {{appointmentTime}}. How they'll connect: {{meetingLocation}}",
      },
    },
    {
      id: "confirmation",
      label: "Send booking confirmation",
      at: "enroll",
      action: { type: "email", template: "confirmation" },
      skipIfPast: false,
      message: {
        audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>",
        subject: "Your follow-up session is confirmed",
        preheader: "See you soon. Here are your session details.",
        body: "Hi {{firstName}},\n\nYour follow-up session with Garrett is confirmed:\n{{appointmentDate}} at {{appointmentTime}}\nHow we'll connect: {{meetingLocation}}\n\nReschedule: {{rescheduleLink}}\nCancel: {{cancellationLink}}\n\nAdd to Google Calendar: {{addToGoogleCalendar}}\nAdd to iCal/Outlook: {{addToIcalOutlook}}\n\nThe Amari Method Team",
      },
    },
    {
      id: "day-before",
      label: "Send day-before email",
      at: "start-1440m",
      when: { field: "reminderPreference", equals: "full" },
      action: { type: "email", template: "day-before" },
      skipIfPast: true,
      message: {
        audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>",
        subject: "Your session on {{appointmentDate}} at {{appointmentTime}}",
        preheader: "Quick reminder about your session tomorrow.",
        body: "Hi {{firstName}},\n\nJust a heads up about your upcoming session with Garrett:\n{{appointmentDate}} at {{appointmentTime}}\nHow we'll connect: {{meetingLocation}}\n\nIf something came up:\nReschedule: {{rescheduleLink}}\nCancel: {{cancellationLink}}\n\nLooking forward to it.\nThe Amari Method Team",
      },
    },
    {
      id: "one-hour-email",
      label: "Send one-hour email",
      at: "start-60m",
      when: { field: "reminderPreference", equals: "full" },
      action: { type: "email", template: "one-hour-email" },
      skipIfPast: true,
      message: {
        audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>",
        subject: "Your session at {{appointmentTime}}",
        preheader: "See you soon.",
        body: "Hi {{firstName}},\n\nYour follow-up session with Garrett is at {{appointmentTime}}.\n{{meetingLocation}}\n\nSee you soon.\nThe Amari Method Team",
      },
    },
    {
      id: "one-hour-sms",
      label: "Send one-hour SMS",
      at: "start-60m",
      when: { field: "reminderPreference", oneOf: ["some", "full"] },
      action: { type: "sms", template: "one-hour-sms" },
      skipIfPast: true,
      message: {
        audience: "client", channel: "sms",
        body: "Hi {{firstName}}, just a friendly reminder. Your appointment with Garrett is at {{appointmentTime}}. {{meetingLocation}}",
      },
    },
    {
      id: "one-hour-internal",
      label: "Notify Garrett by SMS",
      at: "start-60m",
      when: { field: "reminderPreference", oneOf: ["some", "full"] },
      action: { type: "internal_sms", template: "one-hour-internal" },
      skipIfPast: true,
      message: {
        audience: "internal", channel: "sms",
        body: "{{contactName}}'s {{calendarName}} appointment at {{appointmentTime}}. These were the specific issues this person wanted to address (if applicable): {{additionalInformation}} How they'll connect: {{meetingLocation}}",
      },
    },
  ],
});

export const FOLLOW_UP = executableFlow(FOLLOW_UP_WORKFLOW);
