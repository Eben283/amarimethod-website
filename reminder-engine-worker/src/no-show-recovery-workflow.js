import { defineWorkflow, executableFlow } from "./workflow-definition.js";

// Source-staged replacement for GHL's published `No Show Email SMS series`.
// It remains shadow-only until the two exact email subjects and both CTA targets
// are extracted from the live builder, then a controlled all-DND proof passes.
export const NO_SHOW_RECOVERY_WORKFLOW = defineWorkflow({
  id: "no-show-recovery",
  name: "No Show Email SMS series",
  version: 1,
  executionMode: "shadow",
  trigger: {
    event: "appointment_status_changed",
    calendarIds: [
      "bJFkhVP35Ecwh4tLnSmy",
      "G7OAnnJuFbMF6nQSlZVQ",
      "B5aGXLoS4kzAjZAMMXxk",
      "SKDVOL8wtUN6Ne0ppbC9",
      "ZO1jlGfy01rsxVqicoSB",
      "lfsnaiGiLNL2z12pLKDP",
      "oVn77FcecFY16iS2pHyP",
      "ySmht5hx4uZGEpgZrlCw",
      "P7T6M1w8wtuRfwAqzOVw",
      "wO5lnu7BOQOHEJ5YQU0f",
      "waHmG2mHNThPfMVuNJWG",
    ],
    statuses: ["noshow"],
    eventTypes: ["normal"],
  },
  exits: [{ event: "confirmed", effect: "exit_contact_pending", label: "Stop recovery after a confirmed rebooking" }],
  sourceGaps: [
    "Email 1 subject [CONTENT UNKNOWN — extract from GHL]",
    "Email 1 Reschedule Your Session target [CONTENT UNKNOWN — extract from GHL]",
    "Email 2 subject [CONTENT UNKNOWN — extract from GHL]",
    "Email 2 Book Your Session target [CONTENT UNKNOWN — extract from GHL]",
  ],
  nodes: [
    {
      id: "affiliate-soft-sms",
      label: "Send affiliate-partner soft SMS",
      at: "enroll",
      when: { field: "affiliatePartner", equals: "true" },
      action: { type: "sms", template: "affiliate-soft-sms" },
      skipIfPast: false,
      message: {
        audience: "client", channel: "sms",
        body: "Hi {{firstName}}, looks like we missed each other today. No worries at all. Just reply here or text me to find another time. Garrett",
      },
    },
    {
      id: "regular-reschedule-sms",
      label: "Send regular reschedule SMS",
      at: "enroll",
      when: { field: "affiliatePartner", equals: "false" },
      action: { type: "sms", template: "reschedule-sms" },
      skipIfPast: false,
      message: {
        audience: "client", channel: "sms",
        body: "Hi {{firstName}}, we missed you today. Would you like to reschedule your session? {{rescheduleLink}}",
      },
    },
    {
      id: "regular-one-day-email",
      label: "Send first no-show email",
      at: "enroll+1440m",
      when: { field: "affiliatePartner", equals: "false" },
      action: { type: "email", template: "one-day-follow-up" },
      skipIfPast: false,
      message: {
        audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>",
        subject: "[CONTENT UNKNOWN — extract from GHL]",
        body: "Hi {{firstName}},\n\nLooks like we missed each other. Life happens. No judgment.\n\nQuick note on our policy: missed appointments are considered used sessions. We do review rescheduling requests case by case, and series participants receive one complimentary emergency reschedule per series. We ask for 24 hours notice for future changes.\n\nIf you'd like to reschedule:\n\nReschedule Your Session [TARGET UNKNOWN — extract from GHL]\n\nOr just reply here and I'll help find a time.\n\nGarrett",
      },
    },
    {
      id: "regular-two-day-email",
      label: "Send second no-show email",
      at: "enroll+2880m",
      when: { field: "affiliatePartner", equals: "false" },
      action: { type: "email", template: "two-day-follow-up" },
      skipIfPast: false,
      message: {
        audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>",
        subject: "[CONTENT UNKNOWN — extract from GHL]",
        body: "Hi {{firstName}},\n\nI know life gets busy. Scheduling is hard. But your body doesn't stop sending signals just because the calendar got in the way.\n\nIf something is still bothering you, it's worth looking into. Usually something is working too hard because something else isn't working enough. That pattern doesn't fix itself.\n\nWhenever you're ready:\n\nBook Your Session [TARGET UNKNOWN — extract from GHL]\n\nOr just reply here and I'll help find a time.\n\nGarrett",
      },
    },
  ],
});

export const NO_SHOW_RECOVERY = executableFlow(NO_SHOW_RECOVERY_WORKFLOW);
