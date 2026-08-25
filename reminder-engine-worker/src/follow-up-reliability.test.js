import { describe, expect, it } from "vitest";
import { buildFollowUpReliabilityRecord, followUpReliabilityGapMap } from "./follow-up-reliability.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 24, 16);
const input = (over = {}) => ({
  providerExecutionId: "exec-follow-up-1",
  appointmentId: "appt-1",
  payloadSha256: "a".repeat(64),
  payloadReference: "restricted://follow-up-1",
  rawRetentionUntil: NOW + 30 * DAY,
  occurredAt: NOW - 10,
  receivedAt: NOW,
  authenticationResult: "authenticated",
  sourceVersion: "ghl-follow-up-v1",
  runtimeVersion: "git:7f35492",
  ...over,
});

describe("Follow-Up Stage 1 gap adapter", () => {
  it("makes the missing external builder proof explicit", () => {
    expect(followUpReliabilityGapMap()).toMatchObject({ family: "follow-up-session-reminders", acceptanceBlocked: true });
    expect(followUpReliabilityGapMap().missingProof).toHaveLength(4);
  });

  it("never invents obligations before the exact live builder contract is proven", async () => {
    const result = await buildFollowUpReliabilityRecord(input());
    expect(result.accepted).toBe(false);
    expect(result.record.lifecycle).toBeUndefined();
    expect(result.record.obligations).toBeUndefined();
    expect(result.record.sourceEvent.rejectionReason).toMatch(/builder contract is not yet proven/);
  });

  it("preserves rejected identity with or without provider execution identity", async () => {
    const known = await buildFollowUpReliabilityRecord(input());
    const unknown = await buildFollowUpReliabilityRecord(input({ providerExecutionId: null }));
    expect(known.record.sourceEvent.identityKey).toBe("ghl:workflow-execution:exec-follow-up-1");
    expect(unknown.record.sourceEvent.identityKey).toContain("ghl:unproven:appt-1");
    expect(known.record.exception).toMatchObject({ family: "follow-up-session-reminders", accountableOwner: "Eben" });
  });
});
