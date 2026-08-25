import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_FAMILY, RELIABILITY_FEATURE_FLAG, buildAcceptedLifecycle, buildRejectedSource,
  reliabilityEnabled,
} from "../../functions/lib/reliability-contract.js";

const acceptedInput = () => ({
  exceptionFamily: FOLLOW_UP_FAMILY,
  provider: "ghl",
  providerEventId: "execution-123",
  identityVersion: 1,
  identityKey: "ghl:execution-123",
  payloadSha256: "a".repeat(64),
  payloadReference: "restricted://source/execution-123",
  rawRetentionUntil: 200 + 30 * 24 * 60 * 60 * 1000,
  occurredAt: 100,
  receivedAt: 200,
  authenticationResult: "authenticated",
  normalizationState: "normalized",
  normalized: { appointmentId: "appt-1", eventType: "normal", status: "confirmed" },
  sourceVersion: "appointment-events-v1",
  runtimeVersion: "git:7f35492",
  lifecycle: {
    family: FOLLOW_UP_FAMILY,
    scope: "confirmed-normal-follow-up",
    personId: "person-1",
    appointmentId: "appt-1",
    definitionVersion: 2,
    runtimeVersion: "git:7f35492",
  },
  obligations: [
    { obligationKey: "confirmation-email", kind: "observe_confirmation", deadlineAt: 300, ownerRole: "system", closer: "provider_receipt" },
    { obligationKey: "day-before-email", kind: "observe_reminder", deadlineAt: 400, ownerRole: "system", closer: "provider_receipt" },
  ],
});

describe("reliability contract", () => {
  it("is disabled unless the exact feature value is present", () => {
    expect(RELIABILITY_FEATURE_FLAG).toBe("FOLLOW_UP_RELIABILITY_SPINE_ENABLED");
    expect(reliabilityEnabled({})).toBe(false);
    expect(reliabilityEnabled({ FOLLOW_UP_RELIABILITY_SPINE_ENABLED: "true" })).toBe(false);
    expect(reliabilityEnabled({ FOLLOW_UP_RELIABILITY_SPINE_ENABLED: "enabled" })).toBe(true);
  });

  it("derives stable ids and explicit initial obligations", async () => {
    const first = await buildAcceptedLifecycle(acceptedInput());
    const second = await buildAcceptedLifecycle(acceptedInput());
    expect(second).toEqual(first);
    expect(first.sourceEvent.sourceEventId).toMatch(/^src_[a-f0-9]{64}$/);
    expect(first.lifecycle.lifecycleInstanceId).toMatch(/^life_[a-f0-9]{64}$/);
    expect(first.obligations).toHaveLength(2);
    expect(new Set(first.obligations.map((item) => item.obligationId)).size).toBe(2);
  });

  it("refuses unauthenticated, ambiguous, or obligation-free acceptance", async () => {
    await expect(buildAcceptedLifecycle({ ...acceptedInput(), authenticationResult: "rejected" })).rejects.toThrow("authenticated");
    await expect(buildAcceptedLifecycle({ ...acceptedInput(), normalizationState: "ambiguous" })).rejects.toThrow("normalized");
    await expect(buildAcceptedLifecycle({ ...acceptedInput(), obligations: [] })).rejects.toThrow("initial obligations");
    await expect(buildAcceptedLifecycle({
      ...acceptedInput(), rawRetentionUntil: acceptedInput().receivedAt + 30 * 24 * 60 * 60 * 1000 + 1,
    })).rejects.toThrow("30 days");
  });

  it("builds a deterministic rejection and owned exception", async () => {
    const rejected = await buildRejectedSource({
      ...acceptedInput(), normalizationState: "ambiguous", rejectionReason: "provider event identity is ambiguous",
      nextSafeAction: "read the provider execution id", accountableOwner: "Eben",
    });
    expect(rejected.sourceEvent.sourceEventId).toMatch(/^src_/);
    expect(rejected.exception).toMatchObject({ accountableOwner: "Eben", severity: "warning" });
  });
});
