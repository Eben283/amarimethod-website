// Follow-Up Stage 1 reliability ingress. Importing this module is inert: no read or write
// occurs unless the exact reliability feature flag is enabled. When enabled, the adapter
// durably owns source-event identity, the lifecycle instance, and initial obligations before
// the existing reminder engine is allowed to dispatch the event.

import {
  FOLLOW_UP_FAMILY, buildAcceptedLifecycle, buildRejectedSource, reliabilityEnabled, sha256Hex,
} from "../../functions/lib/reliability-contract.js";
import { acceptLifecycle, markSourceDispatched, rejectSourceEvent } from "../../functions/lib/reliability-store.js";
import { enroll } from "./enroll.js";
import { executableFlow } from "./workflow-definition.js";

const SOURCE_VERSION_BINDING = "FOLLOW_UP_RELIABILITY_SOURCE_VERSION";
const RUNTIME_SOURCE_BINDING = "SOURCE_REVISION";
const RUNTIME_VERSION_BINDING = "WORKER_VERSION";

function requiredBinding(env, key) {
  const value = String(env?.[key] || "").trim();
  if (!value) throw new Error(`Follow-Up reliability requires ${key}`);
  return value;
}

function canonicalEventKind(event) {
  return String(event?.appointmentEventType || "").trim().toLowerCase();
}

function canonicalStatus(event) {
  return String(event?.type || event?.status || "").trim().toLowerCase();
}

export function followUpCompositeIdentityV1({ appointmentId, eventKind, status, effectiveStart, payloadSha256 }) {
  const values = ["ghl", appointmentId, eventKind, status, effectiveStart, payloadSha256]
    .map((value) => String(value || "").trim());
  if (values.some((value) => !value)) throw new TypeError("complete Follow-Up composite identity is required");
  return `ghl:appointment-event:v1:${values.join(":")}`;
}

function obligationKind(node) {
  if (node.action.type === "exit_flow") return "external_workflow_exit";
  return `${node.message.audience}_${node.message.channel}`;
}

function obligationCloser(node) {
  return node.action.type === "exit_flow" ? "provider_exit_evidence" : "provider_receipt";
}

function normalizedEvidence(event) {
  return {
    appointmentId: event.appointmentId,
    personId: event.contactId,
    calendarId: event.calendarId,
    status: canonicalStatus(event),
    eventKind: canonicalEventKind(event),
    effectiveStart: event.startAt,
    reminderPreference: String(event.context?.reminderPreference || "full"),
  };
}

async function rejectedRecord({ event, payloadSha256, nowMs, sourceVersion, runtimeVersion, reason, kind, nextSafeAction }) {
  const fallbackIdentity = [
    "ghl", "appointment-event", "v1-rejected", event?.appointmentId || "unknown",
    canonicalEventKind(event) || "unknown", canonicalStatus(event) || "unknown",
    event?.startAt || "unknown", payloadSha256,
  ].join(":");
  return buildRejectedSource({
    provider: "ghl",
    providerEventId: null,
    identityVersion: 1,
    identityKey: fallbackIdentity,
    payloadSha256,
    payloadReference: null,
    rawRetentionUntil: null,
    occurredAt: nowMs,
    receivedAt: nowMs,
    authenticationResult: "authenticated",
    normalizationState: "ambiguous",
    normalized: normalizedEvidence(event || {}),
    rejectionReason: reason,
    sourceVersion,
    runtimeVersion,
    exceptionKind: kind,
    exceptionFamily: FOLLOW_UP_FAMILY,
    accountableOwner: "Eben",
    nextSafeAction,
  });
}

/**
 * Capture one authenticated Follow-Up appointment event in the authoritative reliability spine.
 * Returns before touching D1 when disabled or when the event is outside the exact workflow family.
 */
export async function captureFollowUpReliability({ env, event, rawPayload, nowMs, workflow }) {
  if (!reliabilityEnabled(env)) return { enabled: false, applicable: false };
  if (!workflow || workflow.id !== FOLLOW_UP_FAMILY) throw new Error("published Follow-Up workflow is unavailable");

  const sourceVersion = requiredBinding(env, SOURCE_VERSION_BINDING);
  const sourceRevision = requiredBinding(env, RUNTIME_SOURCE_BINDING);
  const workerVersion = requiredBinding(env, RUNTIME_VERSION_BINDING);
  const runtimeVersion = `${sourceRevision}@${workerVersion}`;
  const flow = executableFlow(workflow);
  if (!flow.calendarIds.includes(event?.calendarId)) return { enabled: true, applicable: false };

  const payloadSha256 = await sha256Hex(rawPayload);
  const status = canonicalStatus(event);
  const eventKind = canonicalEventKind(event);
  const identityComplete = event?.appointmentId && event?.contactId && event?.startAt && status && eventKind;
  const eligibleKind = status === "confirmed" && eventKind === "normal";

  if (!identityComplete || !eligibleKind) {
    const reason = !identityComplete
      ? "Follow-Up source identity is incomplete"
      : "Follow-Up event is outside the confirmed Normal entry contract";
    const record = await rejectedRecord({
      event, payloadSha256, nowMs, sourceVersion, runtimeVersion, reason,
      kind: !identityComplete ? "follow_up_identity_ambiguous" : "follow_up_entry_rejected",
      nextSafeAction: !identityComplete
        ? "Inspect the canonical appointment and bridge payload before replay."
        : "Confirm the appointment status and Event Type before enrollment.",
    });
    const stored = await rejectSourceEvent(env.REMINDER_DB, record, nowMs);
    return { enabled: true, applicable: true, accepted: false, ...stored };
  }

  const enrollment = enroll(event, flow, nowMs);
  if (!enrollment) {
    const record = await rejectedRecord({
      event, payloadSha256, nowMs, sourceVersion, runtimeVersion,
      reason: "Follow-Up event did not satisfy the published workflow entry contract",
      kind: "follow_up_entry_rejected",
      nextSafeAction: "Compare the normalized event with the exact published Follow-Up definition.",
    });
    const stored = await rejectSourceEvent(env.REMINDER_DB, record, nowMs);
    return { enabled: true, applicable: true, accepted: false, ...stored };
  }

  const nodeByTemplate = new Map(workflow.nodes.map((node) => [node.action.template, node]));
  const obligations = enrollment.steps.map((step) => {
    const node = nodeByTemplate.get(step.template);
    if (!node) throw new Error(`published Follow-Up node is missing for ${step.template}`);
    return {
      obligationKey: node.id,
      kind: obligationKind(node),
      deadlineAt: step.dueAt,
      ownerRole: node.message?.audience === "internal" ? "assigned_user" : "system",
      closer: obligationCloser(node),
      initialState: step.status,
    };
  });
  const identityKey = followUpCompositeIdentityV1({
    appointmentId: event.appointmentId,
    eventKind,
    status,
    effectiveStart: event.startAt,
    payloadSha256,
  });
  const record = await buildAcceptedLifecycle({
    provider: "ghl",
    providerEventId: null,
    identityVersion: 1,
    identityKey,
    payloadSha256,
    payloadReference: null,
    rawRetentionUntil: null,
    occurredAt: nowMs,
    receivedAt: nowMs,
    authenticationResult: "authenticated",
    normalizationState: "normalized",
    normalized: normalizedEvidence(event),
    sourceVersion,
    runtimeVersion,
    lifecycle: {
      family: FOLLOW_UP_FAMILY,
      scope: "confirmed-normal-follow-up",
      personId: event.contactId,
      appointmentId: event.appointmentId,
      definitionVersion: workflow.version,
      runtimeVersion,
    },
    obligations,
  });
  const stored = await acceptLifecycle(env.REMINDER_DB, record, nowMs);
  const dispatched = await markSourceDispatched(env.REMINDER_DB, {
    sourceEventId: stored.sourceEvent.source_event_id,
    occurredAt: nowMs,
  });
  return { enabled: true, applicable: true, accepted: true, dispatched, ...stored };
}
