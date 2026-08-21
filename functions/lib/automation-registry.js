// Read-only registry of automations owned by Amari's reminder and nurture engines.
//
// Definitions stay in the engine configs so the scheduler and staff registry cannot drift.
// `definitionVersion` is deliberately explicit: changing trigger/step/exit behavior requires a
// version bump, leaving git history as the immutable definition history until a D1 definition
// snapshot writer is deliberately introduced. This module never calls GHL and never writes D1.

import { FLOWS } from "../../reminder-engine-worker/src/config.js";
import { SEQUENCES } from "../../nurture-engine-worker/src/config.js";
import { MORNING_SMS_DEFINITION } from "../../morning-sms-worker/src/config.js";

export const REGISTRY_VERSION = 1;

const OWNED_ONLY_GAP = Object.freeze({
  code: "owned_definitions_only",
  label: "This registry covers the automations currently owned in Amari code; former external workflow definitions are not represented.",
});

const PRE_REGISTRY_HISTORY_GAP = Object.freeze({
  code: "pre_registry_history_not_imported",
  label: "Execution before the owned D1 event log is not represented unless it was explicitly imported.",
});

const DELIVERY_GAP = Object.freeze({
  code: "delivery_receipt_coverage_partial",
  label: "SMS delivery is reconciled from GHL by exact message reference. Gmail proves provider acceptance only; affirmative delivery and mailbox-bounce ingestion are not currently available.",
});

const DB_UNAVAILABLE_GAP = Object.freeze({
  code: "execution_store_unavailable",
  label: "The shared automation execution store is not bound, so enrollments and execution events cannot be read.",
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// Registry-only read model. It makes the live source copy inspectable during shadow proof, but
// is never imported by the reminder engine or a delivery adapter.
const PARTNER_INITIAL_IN_PERSON_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Source-verified read-only copy. This shadow definition does not send messages.",
  notices: Object.freeze([
    Object.freeze({ stepIndex: 0, audience: "internal", channel: "email", subject: "{{contact.first_name}} booked a {{calendar.name}}", body: "Hi {{user.first_name}},\n\n{{contact.name}} booked a {{calendar.name}} for {{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n\nStudio: 662 8th Ave, San Francisco, CA 94118" }),
    Object.freeze({ stepIndex: 1, audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "Your partner session is confirmed", preheader: "See you soon. Here are your session details.", body: "Hi {{contact.first_name}},\n\nYour session with Garrett is confirmed:\n\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n662 8th Ave, San Francisco, CA 94118\n\nA few reminders:\n• 60-minute session\n• Wear comfortable clothes\n• Allow time for parking\n\nReschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nAdd to Google Calendar {{appointment.add_to_google_calendar}} · Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nThe Amari Method Team" }),
    Object.freeze({ stepIndex: 2, audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "See you tomorrow, {{contact.first_name}}", preheader: "Quick reminder about your session tomorrow.", body: "Hi {{contact.first_name}},\n\nJust a heads up about your upcoming session with Garrett:\n\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n662 8th Ave, San Francisco, CA 94118\n\nIf something came up:\nReschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nThe Amari Method Team" }),
    Object.freeze({ stepIndex: 3, audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "Your session is in 1 hour", preheader: "See you soon.", body: "Hi {{contact.first_name}},\n\nYour session with Garrett is at {{appointment.only_start_time}} {{appointment.timezone}}.\n\n662 8th Ave, San Francisco, CA 94118\n\nThe Amari Method Team" }),
    Object.freeze({ stepIndex: 4, audience: "client", channel: "sms", body: "Hi {{contact.first_name}}, just a friendly reminder that your appointment with Garrett is in one hour." }),
    Object.freeze({ stepIndex: 5, audience: "internal", channel: "sms", body: "{{contact.name}}'s {{calendar.name}} appointment at {{appointment.only_start_time}} {{appointment.timezone}}. These were the specific issues this person wanted to address (if applicable): {{contact.additional_information}}" }),
  ]),
});

// Registry-only source-copy for the next bounded reminder subset. These constants are never
// imported by the engine or a sender; they let Staff compare the source copy with the shadow
// definition before a delivery adapter exists.
const INITIAL_IN_PERSON_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Source-verified read-only copy. This reconciled shadow definition does not send messages.",
  notices: Object.freeze([
    Object.freeze({ stepIndex: 0, audience: "internal", channel: "email", subject: "{{contact.first_name}} booked a {{calendar.name}}", body: "Hi, Big Dog,\n\n{{contact.name}} booked a {{calendar.name}} for {{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n\nStudio: 662 8th Ave, San Francisco, CA 94118" }),
    Object.freeze({ stepIndex: 1, audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "You're booked — here's what to expect", preheader: "Your session with Garrett is confirmed", body: "Hi {{contact.first_name}},\n\nYour session with Garrett is confirmed:\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n662 8th Ave, San Francisco, CA 94118\n\nWear something comfortable you can move in. That's all you need.\n\nAdd to Calendar: Add to Google Calendar {{appointment.add_to_google_calendar}} · Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nIf something came up: Reschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nWe look forward to seeing you.\nThe Amari Method Team" }),
    Object.freeze({ stepIndex: 2, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session on {{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}", preheader: "Quick reminder about your session tomorrow", body: "Hi {{contact.first_name}},\n\nJust a heads up about your upcoming session:\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n662 8th Ave, San Francisco, CA 94118\n\nAdd to Calendar: Add to Google Calendar {{appointment.add_to_google_calendar}} · Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nIf something came up: Reschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nLooking forward to it.\nGarrett" }),
    Object.freeze({ stepIndex: 3, audience: "client", channel: "sms", body: "Hi {{contact.first_name}}, just a friendly reminder — your appointment with Garrett is at {{appointment.only_start_time}} {{appointment.timezone}}. 662 8th Ave, San Francisco, CA 94118" }),
    Object.freeze({ stepIndex: 4, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session at {{appointment.only_start_time}} {{appointment.timezone}}", body: "Hi {{contact.first_name}},\n\nYour Amari Method session is at {{appointment.only_start_time}} {{appointment.timezone}}.\n662 8th Ave, San Francisco, CA 94118\n\nSee you soon.\nGarrett" }),
    Object.freeze({ stepIndex: 5, audience: "internal", channel: "sms", body: "{{contact.name}}'s {{calendar.name}} appointment at {{appointment.only_start_time}} {{appointment.timezone}}. These were the specific issues this person wanted to address (if applicable): {{contact.additional_information}}" }),
  ]),
});

const INITIAL_VIRTUAL_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Source-verified read-only copy. This reconciled shadow definition does not send messages.",
  notices: Object.freeze([
    Object.freeze({ stepIndex: 0, audience: "internal", channel: "email", subject: "{{contact.name}} booked a {{calendar.name}}", body: "Hi {{user.first_name}},\n\n{{contact.name}} booked a {{calendar.name}} for {{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n\nHow we'll connect: {{appointment.meeting_location}}" }),
    Object.freeze({ stepIndex: 1, audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "You're booked, here's what to expect", preheader: "Your first Amari Method session is confirmed.", body: "Hi {{contact.first_name}},\n\nYou're confirmed for your first Amari Method session with Garrett. Here's everything you need.\n\nSession Details — Date: {{appointment.only_start_date}}\nTime: {{appointment.only_start_time}} {{appointment.timezone}}\nDuration: 60 minutes\n\nJoining Your Session — We use Google Meet. Your link: {{appointment.meeting_location}}. Please test your camera and mic beforehand. Find a quiet space with at least 6' x 6' of room to move.\n\nEquipment — It's most helpful to have everything below ready for your first session. We may not use it all today, that depends on what we focus on, but you'll use these as your practice continues.\nYoga block, required. We'll use it in the first session. → https://amzn.to/4kDykic\nHigh-density foam roller → https://amzn.to/4rjKlfk\nPull-up bar → https://amzn.to/3ZzXYel\nGymnastic rings → https://amzn.to/4aB3MsS\n\nWhat to Wear — Wear something comfortable you can move in.\n\nReschedule {{appointment.reschedule_link}} | Cancel {{appointment.cancellation_link}}\nAdd to Google Calendar {{appointment.add_to_google_calendar}} | Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nThe Amari Method Team" }),
    Object.freeze({ stepIndex: 2, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "See you tomorrow, {{contact.first_name}}", preheader: "Quick reminder about your session tomorrow", body: "Hi {{contact.first_name}},\n\nJust a heads up about your upcoming session:\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\nHow we'll connect: {{appointment.meeting_location}}\n\nAdd to Google Calendar {{appointment.add_to_google_calendar}} · Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nIf something came up: Reschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nLooking forward to it.\nGarrett" }),
    Object.freeze({ stepIndex: 3, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session is in 1 hour", preheader: "Your Google Meet link is below.", body: "Hi {{contact.first_name}},\n\nYour session with Garrett is at {{appointment.only_start_time}} {{appointment.timezone}}.\nGoogle Meet: {{appointment.meeting_location}}\n\nA few things before we start:\n- Join 5 minutes early to test your connection.\n- Have your equipment ready: foam roller, yoga block, pull-up bar, gymnastic rings.\n- Find a quiet space with room to move (at least 6' x 6').\n- Wear comfortable clothes you can move in.\n\nIf you have trouble connecting, call us at (628) 877-7673.\n\nSee you soon.\nGarrett" }),
    Object.freeze({ stepIndex: 4, audience: "client", channel: "sms", body: "Hi {{contact.first_name}}, just a friendly reminder. Your appointment with Garrett is at {{appointment.only_start_time}} {{appointment.timezone}}. Here is the link: {{appointment.meeting_location}}" }),
    Object.freeze({ stepIndex: 5, audience: "internal", channel: "sms", body: "{{contact.name}}'s {{calendar.name}} appointment at {{appointment.only_start_time}} {{appointment.timezone}}. These were the specific issues this person wanted to address (if applicable): {{contact.additional_information}} Here is the meeting link: {{appointment.meeting_location}}" }),
  ]),
});

const ASSESSMENT_NO_SHOW_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Source-verified read-only copy from No Show Email SMS series. This shadow definition does not send messages.",
  notices: Object.freeze([
    Object.freeze({ stepIndex: 0, audience: "client", channel: "sms", body: "Hi {{contact.first_name}}, we missed you today. Would you like to reschedule your session? {{appointment.reschedule_link}}" }),
    Object.freeze({ stepIndex: 1, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", body: "Hi {{contact.first_name}},\n\nLooks like we missed each other. Life happens. No judgment.\n\nQuick note on our policy: missed appointments are considered used sessions. We do review rescheduling requests case by case, and series participants receive one complimentary emergency reschedule per series. We ask for 24 hours notice for future changes.\n\nIf you'd like to reschedule:\n\nReschedule Your Session\n\nOr just reply here and I'll help find a time.\n\nGarrett" }),
    Object.freeze({ stepIndex: 2, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", body: "Hi {{contact.first_name}},\n\nI know life gets busy. Scheduling is hard. But your body doesn't stop sending signals just because the calendar got in the way.\n\nIf something is still bothering you, it's worth looking into. Usually something is working too hard because something else isn't working enough. That pattern doesn't fix itself.\n\nWhenever you're ready:\n\nBook Your Session\n\nOr just reply here and I'll help find a time.\n\nGarrett" }),
  ]),
});

// Read-only activation map for the first cutover slice. This is deliberately outside the
// reminder-engine config: it records what still belongs to the provider rather than making the
// scheduler imply it can perform those actions.
const PARTNER_INITIAL_IN_PERSON_CUTOVER_READINESS = Object.freeze({
  status: "not_eligible",
  label: "Not eligible for active delivery",
  summary: "Shadow enrollment and cancellation are proven. GHL remains the sender until every blocked behavior below has an owned, verified replacement.",
  requirements: Object.freeze([
    Object.freeze({
      code: "native_lifecycle_shadow_proven",
      status: "proven",
      label: "Native appointment lifecycle",
      detail: "Confirmed enrollment, immediate would-send evidence, and cancellation of all four future reminders were proven beside the live flow on Aug. 9. No message was sent.",
    }),
    Object.freeze({
      code: "no_show_series_exit_not_owned",
      status: "blocked",
      label: "Exit No Show Email SMS series on confirmation",
      detail: "This is the first action in the live confirmation workflow. It is still owned by GHL and must be preserved and proven before activation.",
    }),
    Object.freeze({
      code: "delivery_templates_and_adapter_not_owned",
      status: "blocked",
      label: "Deliver the exact messages from Amari",
      detail: "The six messages below are source-verified previews only. No owned template renderer or email/SMS sender adapter is active.",
    }),
    Object.freeze({
      code: "quiet_period_evidence_pending",
      status: "review",
      label: "Check the quiet period",
      detail: "Review the scoped appointment window for duplicate, late, or missing reminders before any owned message can become active.",
    }),
    Object.freeze({
      code: "ghl_retirement_not_approved",
      status: "blocked",
      label: "Keep the GHL confirmation flow live",
      detail: "Retirement needs separate approval after the blocked checks are closed and owned delivery evidence agrees with the live path.",
    }),
  ]),
});

const INITIAL_IN_PERSON_CUTOVER_READINESS = Object.freeze({
  status: "active",
  label: "Owned delivery is live",
  summary: "The owned Initial / Assessment in-person lifecycle is the live sender. The former GHL workflow is retained in Draft as rollback.",
  requirements: Object.freeze([
    Object.freeze({ code: "source_contract_reconciled", status: "proven", label: "Source contract reconciled", detail: "The six current messages and both in-person calendars are represented in the owned lifecycle." }),
    Object.freeze({ code: "owned_delivery_proven", status: "proven", label: "Owned delivery proven", detail: "Owned Gmail confirmation, client SMS, and Garrett SMS were each proven in controlled delivery checks." }),
    Object.freeze({ code: "native_cancellation_proven", status: "proven", label: "Cancellation proven", detail: "A native Assessment cancellation cancelled the remaining owned future steps." }),
    Object.freeze({ code: "first_live_run_pending", status: "review", label: "Watch the first ordinary booking", detail: "The first normal booking and cancellation after cutover should be read back in the owned run ledger." }),
    Object.freeze({ code: "assessment_no_show_separate_gap", status: "review", label: "Assessment no-show remains separate", detail: "This reminder cutover is live; the separate Assessment no-show recovery family is still shadow-only." }),
    Object.freeze({ code: "ghl_draft_rollback", status: "proven", label: "GHL rollback retained", detail: "The former GHL workflow is intact in Draft and can be republished if needed." }),
  ]),
});

const INITIAL_VIRTUAL_CUTOVER_READINESS = Object.freeze({
  status: "not_eligible",
  label: "Not eligible for active delivery",
  summary: "The source contract is reconciled in code only. This legacy virtual definition has not yet run beside GHL on an all-DND test appointment.",
  requirements: Object.freeze([
    Object.freeze({ code: "source_contract_reconciled", status: "proven", label: "Source contract reconciled", detail: "Confirmed-only user/customer triggers and all six live message actions are represented in the shadow definition." }),
    Object.freeze({ code: "native_shadow_proof_pending", status: "review", label: "Prove a native shadow run", detail: "Use a dedicated all-DND appointment to verify enrollment, due timing, reschedule, and cancellation without sending a message." }),
    Object.freeze({ code: "no_show_series_exit_not_owned", status: "blocked", label: "Preserve the No Show Email SMS series exit", detail: "The related legacy pipeline workflow currently owns this exit. It remains external behavior until an owned replacement is implemented and proven." }),
    Object.freeze({ code: "delivery_templates_and_adapter_not_owned", status: "blocked", label: "Deliver the exact messages from Amari", detail: "The six messages below are source-verified previews only. No owned template renderer or email/SMS sender adapter is active." }),
    Object.freeze({ code: "ghl_retirement_not_approved", status: "blocked", label: "Keep the GHL reminder workflow live", detail: "Retirement needs separate approval after all gates close and owned delivery evidence agrees with the live path." }),
  ]),
});

const ASSESSMENT_NO_SHOW_CUTOVER_READINESS = Object.freeze({
  status: "not_eligible",
  label: "Not eligible for active delivery",
  summary: "The former gap is modeled in owned shadow code only. The current GHL no-show workflow does not cover Assessment, so this requires a dedicated safe proof before it can replace anything.",
  requirements: Object.freeze([
    Object.freeze({ code: "source_contract_reconciled", status: "proven", label: "Source contract reconciled", detail: "The three-message No Show Email SMS series and an Assessment-confirmed rebooking exit are represented in owned shadow code." }),
    Object.freeze({ code: "native_shadow_proof_pending", status: "review", label: "Prove the no-show lifecycle safely", detail: "Use a dedicated all-DND Assessment appointment to verify no-show enrollment, one-day timing, and confirmed rebooking exit without sending a client message." }),
    Object.freeze({ code: "delivery_templates_and_adapter_not_owned", status: "blocked", label: "Deliver the exact messages from Amari", detail: "The three messages are source-verified previews only. No owned template renderer or email/SMS sender adapter is active." }),
    Object.freeze({ code: "ghl_retirement_not_approved", status: "blocked", label: "Keep GHL live until activation", detail: "Activation and retirement need separate approval after shadow evidence proves the whole lifecycle." }),
  ]),
});

function reminderDefinition(flow) {
  const definition = {
    id: `reminder:${flow.flowKey}`,
    engine: "reminder",
    key: flow.flowKey,
    name: flow.name,
    definitionVersion: flow.definitionVersion,
    mode: flow.mode,
    trigger: clone({ calendarIds: flow.calendarIds, ...flow.enrollOn }),
    exits: clone([
      ...flow.cancelOn.map((status) => ({ kind: "appointment", statuses: [status] })),
      ...(flow.exitOn || []).map((status) => ({ kind: "rebooking", statuses: [status], scope: "contact" })),
    ]),
    steps: flow.steps.map((step, stepIndex) => ({ stepIndex, ...clone(step) })),
    source: {
      kind: "owned_code",
      path: "reminder-engine-worker/src/config.js",
    },
  };
  if (flow.flowKey === "partner-initial-in-person") {
    definition.messagePreview = clone(PARTNER_INITIAL_IN_PERSON_MESSAGE_PREVIEW);
    definition.cutoverReadiness = clone(PARTNER_INITIAL_IN_PERSON_CUTOVER_READINESS);
  }
  if (flow.flowKey === "initial-in-person") {
    definition.messagePreview = clone(INITIAL_IN_PERSON_MESSAGE_PREVIEW);
    definition.cutoverReadiness = clone(INITIAL_IN_PERSON_CUTOVER_READINESS);
  }
  if (flow.flowKey === "initial-virtual") {
    definition.messagePreview = clone(INITIAL_VIRTUAL_MESSAGE_PREVIEW);
    definition.cutoverReadiness = clone(INITIAL_VIRTUAL_CUTOVER_READINESS);
  }
  if (flow.flowKey === "assessment-no-show") {
    definition.messagePreview = clone(ASSESSMENT_NO_SHOW_MESSAGE_PREVIEW);
    definition.cutoverReadiness = clone(ASSESSMENT_NO_SHOW_CUTOVER_READINESS);
  }
  return definition;
}

function nurtureDefinition(sequence) {
  return {
    id: `nurture:${sequence.sequenceId}`,
    engine: "nurture",
    key: sequence.sequenceId,
    name: sequence.name,
    definitionVersion: sequence.definitionVersion,
    mode: sequence.mode,
    trigger: clone(sequence.entry),
    exits: clone(sequence.exits),
    steps: sequence.steps.map((step, stepIndex) => ({ stepIndex, ...clone(step) })),
    source: {
      kind: "owned_code",
      path: "nurture-engine-worker/src/config.js",
    },
  };
}

const DEFINITIONS = Object.freeze([
  ...FLOWS.map(reminderDefinition),
  ...SEQUENCES.map(nurtureDefinition),
  MORNING_SMS_DEFINITION,
].map(Object.freeze));

export function automationDefinitions() {
  return DEFINITIONS.map(clone);
}

export function findAutomationDefinition(engine, key) {
  const found = DEFINITIONS.find((definition) => definition.engine === engine && definition.key === key);
  return found ? clone(found) : null;
}

export function registryEvidence({ executionStoreConfigured }) {
  const gaps = [OWNED_ONLY_GAP, PRE_REGISTRY_HISTORY_GAP, DELIVERY_GAP];
  if (!executionStoreConfigured) gaps.push(DB_UNAVAILABLE_GAP);
  return {
    definitionSource: "owned_code",
    enrollmentSource: executionStoreConfigured ? "owned_d1" : "unavailable",
    executionSource: executionStoreConfigured ? "owned_d1_append_only_log" : "unavailable",
    gaps: gaps.map(clone),
  };
}

export function eventEvidence(event, { terminalOutcome = null } = {}) {
  const gaps = [];
  if (["reminder", "nurture"].includes(event.engine) && event.flow_key) {
    const current = DEFINITIONS.find((definition) => definition.engine === event.engine && definition.key === event.flow_key);
    if (event.definition_version == null) {
      gaps.push({
        code: "definition_version_not_recorded",
        label: "This event predates definition-version capture, so its exact definition revision is unknown.",
      });
    } else if (current && event.definition_version !== current.definitionVersion) {
      gaps.push({
        code: "historical_definition_snapshot_not_loaded",
        label: `This event used definition version ${event.definition_version}; the read API currently exposes version ${current.definitionVersion}.`,
      });
    }
  }
  if (event.channel && !event.message_ref) {
    gaps.push({
      code: "message_reference_missing",
      label: "No transport message reference was recorded for this event.",
    });
  }
  if (event.action === "send" && !["delivered", "bounced", "failed"].includes(event.outcome) && !terminalOutcome) {
    if (event.channel === "email") {
      gaps.push({
        code: "email_final_delivery_unavailable",
        label: "Gmail accepted this message. Gmail does not provide an affirmative recipient-delivery receipt, and this workflow does not currently ingest mailbox bounce evidence.",
      });
    } else {
      gaps.push({
        code: "delivery_outcome_pending",
        label: "The provider accepted this message, but its terminal delivery status has not been recorded yet.",
      });
    }
  }
  return { source: "owned_d1_append_only_log", gaps };
}
