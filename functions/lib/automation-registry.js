// Read-only registry of automations owned by Amari's reminder and nurture engines.
//
// Definitions stay in the engine configs so the scheduler and staff registry cannot drift.
// `definitionVersion` is deliberately explicit: changing trigger/step/exit behavior requires a
// version bump, leaving git history as the immutable definition history until a D1 definition
// snapshot writer is deliberately introduced. This module never calls GHL and never writes D1.

import { FLOWS } from "../../reminder-engine-worker/src/config.js";
import { SEQUENCES } from "../../nurture-engine-worker/src/config.js";

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
  label: "A send event reports the outcome recorded by the owned engine; delivery is not assumed without a recorded delivery outcome or message reference.",
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

function reminderDefinition(flow) {
  const definition = {
    id: `reminder:${flow.flowKey}`,
    engine: "reminder",
    key: flow.flowKey,
    name: flow.name,
    definitionVersion: flow.definitionVersion,
    mode: flow.mode,
    trigger: clone({ calendarIds: flow.calendarIds, ...flow.enrollOn }),
    exits: clone(flow.cancelOn.map((status) => ({ kind: "appointment", statuses: [status] }))),
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

export function eventEvidence(event) {
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
  if (event.action === "send" && !["delivered", "bounced", "failed"].includes(event.outcome)) {
    gaps.push({
      code: "delivery_outcome_not_recorded",
      label: "This event does not prove final delivery.",
    });
  }
  return { source: "owned_d1_append_only_log", gaps };
}
