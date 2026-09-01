import { describe, expect, it } from "vitest";

import { ownedNurtureDeliveryReadiness } from "./delivery-readiness.js";

function db({ statuses = [], events = [], submissions = [], outcomes = [] } = {}) {
  return {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          if (sql.includes("FROM nurture_steps")) return { results: statuses };
          if (sql.includes("FROM automation_events")) return { results: events };
          if (sql.includes("FROM gmail_provider_submissions")) return { results: submissions };
          if (sql.includes("FROM gmail_provider_events")) return { results: outcomes };
          throw new Error(`unexpected query: ${sql}`);
        },
      };
    },
  };
}

const submissionEvent = (overrides = {}) => ({
  ts: 1,
  outcome: "submitted",
  message_ref: "gmail-1",
  detail: JSON.stringify({ deliveryKey: "flow-1-quiz:contact-1:v2:s0" }),
  ...overrides,
});

describe("ownedNurtureDeliveryReadiness", () => {
  it("returns aggregate exact-submission and stuck-claim exceptions without identifiers", async () => {
    const result = await ownedNurtureDeliveryReadiness(db({
      statuses: [{ status: "dispatching", count: 1 }, { status: "submitted", count: 1 }],
      events: [submissionEvent()],
    }), db({
      submissions: [{ submission_ref: "flow-1-quiz:contact-1:v2:s0", provider_message_id: "gmail-1" }],
    }), {
      NURTURE_EMAIL_DELIVERY_RELEASE: "approved",
      NURTURE_EMAIL_SEQUENCE_ALLOWLIST: '["flow-1-quiz"]',
    });

    expect(result).toEqual(expect.objectContaining({
      state: "attention",
      deliveryEnabled: false, // every reviewed source sequence is still shadow
      evidenceWindow: expect.objectContaining({
        observedSubmissions: 1,
        exactProviderSubmissions: 1,
        providerOutcomeMissing: 1,
        terminalSuccessProven: 0,
      }),
      exceptions: expect.objectContaining({ stuckDispatchClaims: 1 }),
    }));
    expect(JSON.stringify(result)).not.toContain("contact-1");
    expect(JSON.stringify(result)).not.toContain("gmail-1");
  });

  it("flags missing submission proof and terminal provider failures", async () => {
    const key = "flow-1-quiz:contact-1:v2:s0";
    const missing = await ownedNurtureDeliveryReadiness(db({ events: [submissionEvent()] }), db(), {});
    expect(missing.state).toBe("attention");
    expect(missing.exceptions.missingSubmissionEvidence).toBe(1);

    const failed = await ownedNurtureDeliveryReadiness(db({ events: [submissionEvent()] }), db({
      submissions: [{ submission_ref: key, provider_message_id: "gmail-1" }],
      outcomes: [{ submission_ref: key, outcome: "bounced", occurred_at: "2026-09-01T00:00:00Z" }],
    }), {});
    expect(failed.exceptions.terminalFailures).toBe(1);
    expect(failed.evidenceWindow.acceptedOutcomes).toBe(0);
  });

  it("is empty when no delivery has occurred and unavailable without bindings/schema", async () => {
    await expect(ownedNurtureDeliveryReadiness(db(), db(), {})).resolves.toEqual(expect.objectContaining({ state: "empty" }));
    await expect(ownedNurtureDeliveryReadiness(null, db(), {})).resolves.toEqual(expect.objectContaining({ state: "unavailable" }));
    const broken = { prepare() { throw new Error("missing table"); } };
    await expect(ownedNurtureDeliveryReadiness(broken, db(), {})).resolves.toEqual(expect.objectContaining({ state: "unavailable" }));
  });
});
