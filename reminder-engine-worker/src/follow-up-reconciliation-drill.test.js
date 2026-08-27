import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  FOLLOW_UP_OPERATOR_DRILL_VERSION,
  runFollowUpReconciliationOperatorDrill,
} from "./follow-up-reconciliation-drill.js";

describe("local Follow-Up reconciliation operator drill", () => {
  it("audits an accepted obligation's missing receipt through resolution without production authority", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error("operator drill must not access the network");
    });
    globalThis.fetch = fetchSpy;
    try {
      const result = await runFollowUpReconciliationOperatorDrill({
        actor: "Eben",
        nowMs: Date.UTC(2026, 7, 27, 5, 0, 0),
      });

      expect(result).toMatchObject({
        drillVersion: FOLLOW_UP_OPERATOR_DRILL_VERSION,
        simulation: true,
        authority: false,
        productionHealthImpact: false,
        mechanicsOnly: true,
        providerReceiptObserved: false,
        obligationOutcomeProven: false,
        family: "follow-up-session-reminders",
        sourceState: "accepted",
        finalObligationState: "pending",
        finalExceptionState: "resolved",
        checks: {
          immutableSourceBlocked: true,
          queueLifecycleVisible: true,
          reusedTransitionBlocked: true,
          staleTargetReplayBlocked: true,
          staleTransitionBlocked: true,
        },
        localDatabaseCounts: {
          commandAttempts: 1,
          exceptionEvents: 4,
          exceptions: 1,
          lifecycleInstances: 1,
          obligations: 1,
          providerReceipts: 0,
          reconciliationRuns: 0,
          sourceEvents: 1,
        },
        networkCalls: 0,
        providerCalls: 0,
        runtimeBindingsUsed: 0,
      });
      expect(result.queueStates).toEqual(["open", "acknowledged", "investigating", "resolved_absent"]);
      expect(result.sourceEventId).toMatch(/^src_[a-f0-9]{64}$/);
      expect(result.lifecycleInstanceId).toMatch(/^life_[a-f0-9]{64}$/);
      expect(result.obligationId).toMatch(/^obl_[a-f0-9]{64}$/);
      expect(result.auditEvents.map((event) => event.eventType)).toEqual([
        "opened",
        "acknowledged",
        "investigating",
        "resolved",
      ]);
      expect(result.auditEvents.map((event) => event.actor)).toEqual([
        "system",
        "Eben",
        "Eben",
        "Eben",
      ]);
      expect(new Set(result.auditEvents.map((event) => event.eventId)).size).toBe(4);
      expect(result.auditEvents.every((event) => (
        Number.isSafeInteger(event.occurredAt)
        && /^[a-f0-9]{64}$/.test(event.evidenceSha256)
        && event.detail.simulation === true
      ))).toBe(true);
      expect(result.auditEvents[0].detail).toMatchObject({
        commandAttemptId: result.commandAttemptId,
        reason: "expected provider receipt absent",
        simulation: true,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("is statically isolated from provider, network, and runtime bindings", () => {
    const source = readFileSync(new URL("./follow-up-reconciliation-drill.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:fetch|Request|Response|WebSocket)\s*\(/);
    expect(source).not.toMatch(/\b(?:env|ctx)\./);
    expect(source).not.toContain("AUTOMATION_DB");
    expect(source).not.toContain("wrangler");
    expect(source).not.toContain("cloudflare");
  });

  it("does not allow a non-owner actor to perform the operator drill", async () => {
    await expect(runFollowUpReconciliationOperatorDrill({ actor: "Garrett" }))
      .rejects.toThrow("requires actor Eben");
  });
});
