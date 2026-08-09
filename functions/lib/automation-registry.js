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

function reminderDefinition(flow) {
  return {
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
