// Stage 1 Follow-Up gap adapter. Deliberately not imported by webhook.js/index.js.
// Stage 0 has not yet proven the exact live GHL builder trigger/action/wait/copy contract,
// so this adapter may preserve durable evidence and an exception only. It must not invent
// lifecycle obligations from an owned approximation of the external sender.

import { FOLLOW_UP_FAMILY, buildRejectedSource } from "../../functions/lib/reliability-contract.js";

export function followUpReliabilityGapMap() {
  return Object.freeze({
    family: FOLLOW_UP_FAMILY,
    acceptanceBlocked: true,
    missingProof: Object.freeze([
      "exact live GHL builder trigger and filters",
      "exact action order and waits",
      "exact message copy and sender settings",
      "immutable provider execution identity and acknowledgement contract",
    ]),
    nextSafeAction: "Complete the authorized read-only Stage 0 builder extraction before materializing lifecycle obligations.",
  });
}

export async function buildFollowUpReliabilityRecord(input) {
  const gap = followUpReliabilityGapMap();
  const identity = input.providerExecutionId
    ? `ghl:workflow-execution:${input.providerExecutionId}`
    : `ghl:unproven:${input.appointmentId || "unknown"}:${input.payloadSha256}`;
  return {
    accepted: false,
    gap,
    record: await buildRejectedSource({
      provider: "ghl",
      providerEventId: input.providerExecutionId || null,
      identityVersion: 1,
      identityKey: identity,
      payloadSha256: input.payloadSha256,
      payloadReference: input.payloadReference,
      rawRetentionUntil: input.rawRetentionUntil,
      occurredAt: input.occurredAt,
      receivedAt: input.receivedAt,
      authenticationResult: input.authenticationResult,
      normalizationState: "ambiguous",
      rejectionReason: "exact live Follow-Up builder contract is not yet proven",
      sourceVersion: input.sourceVersion,
      runtimeVersion: input.runtimeVersion,
      exceptionKind: "follow_up_builder_contract_unproven",
      exceptionFamily: FOLLOW_UP_FAMILY,
      accountableOwner: "Eben",
      nextSafeAction: gap.nextSafeAction,
    }),
  };
}
