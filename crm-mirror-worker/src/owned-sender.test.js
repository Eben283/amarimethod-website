import { describe, expect, it } from "vitest";
import { deliveryReadiness, evaluateDeliveryEligibility, recordShadowDeliveryAttempt } from "./owned-sender.js";

describe("owned sender foundation", () => {
  const contact = { email_normalized: "client@example.test", phone_e164: "+14155550100" };

  it("remains shadow-only even when the consent policy is eligible", () => {
    const decision = evaluateDeliveryEligibility({ contact, channel: "sms", consents: [{ channel: "sms", state: "granted" }] });
    expect(decision.policyEligible).toBe(true);
    expect(decision.deliveryAllowed).toBe(false);
    expect(decision.reasons).toContain("sender_shadow_mode");
    expect(deliveryReadiness()).toMatchObject({ mode: "shadow", deliveryEnabled: false });
    expect(deliveryReadiness().channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", provider: "google-workspace", configured: false }),
      expect.objectContaining({ channel: "sms", provider: "twilio", configured: false }),
    ]));
  });

  it("requires an explicit grant and honors DND before a future provider is considered", () => {
    expect(evaluateDeliveryEligibility({ contact, channel: "email", consents: [] }).reasons)
      .toEqual(expect.arrayContaining(["explicit_consent_required", "sender_shadow_mode"]));
    expect(evaluateDeliveryEligibility({ contact, channel: "sms", consents: [{ channel: "sms", state: "granted" }], dnd: "on" }).reasons)
      .toEqual(expect.arrayContaining(["do_not_disturb", "sender_shadow_mode"]));
  });

  it("does not let an unknown observation mask explicit consent evidence", () => {
    const decision = evaluateDeliveryEligibility({
      contact,
      channel: "sms",
      consents: [{ channel: "sms", state: "unknown" }, { channel: "sms", state: "granted" }],
    });
    expect(decision.consentState).toBe("granted");
  });

  it("writes an append-only shadow audit without a provider call or raw message content", async () => {
    const statements = [];
    const db = {
      prepare(sql) { return { bind(...values) { statements.push({ sql, values }); return { sql, values }; } }; },
      batch: async (batch) => { expect(batch).toHaveLength(2); },
    };
    const result = await recordShadowDeliveryAttempt(db, {
      contactId: "contact-1", actor: "Staff QA", channel: "email", contact,
      consents: [{ channel: "email", state: "granted" }], content: "Private message body",
    }, "2026-08-03T12:00:00.000Z");
    expect(result.deliveryAllowed).toBe(false);
    expect(statements).toHaveLength(2);
    expect(JSON.stringify(statements)).not.toContain("Private message body");
    expect(statements[0].values[7]).toMatch(/^[a-f0-9]{64}$/);
  });
});
