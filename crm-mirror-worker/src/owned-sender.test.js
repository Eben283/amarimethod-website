import { describe, expect, it } from "vitest";
import { deliveryReadiness, evaluateDeliveryEligibility, recordDeliveredAttempt, recordShadowDeliveryAttempt } from "./owned-sender.js";

describe("owned sender foundation", () => {
  const contact = { email_normalized: "client@example.test", phone_e164: "+14155550100" };

  it("reports individual staff email as active only when Google is configured", () => {
    const decision = evaluateDeliveryEligibility({ contact, channel: "sms", consents: [{ channel: "sms", state: "granted" }] });
    expect(decision.policyEligible).toBe(true);
    expect(decision.deliveryAllowed).toBe(true);
    expect(deliveryReadiness()).toMatchObject({ mode: "staff_email", deliveryEnabled: false });
    expect(deliveryReadiness({ PORTAL_KV: {}, GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" })).toMatchObject({ mode: "staff_email", deliveryEnabled: true });
    expect(deliveryReadiness().channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", provider: "google-workspace", configured: false }),
      expect.objectContaining({ channel: "sms", provider: "twilio", configured: false }),
    ]));
  });

  it("allows a contact without a recorded opt-in unless the channel is opted out, and honors DND", () => {
    const unknown = evaluateDeliveryEligibility({ contact, channel: "email", consents: [] });
    expect(unknown.policyEligible).toBe(true);
    expect(unknown.reasons).toEqual([]);
    expect(evaluateDeliveryEligibility({ contact, channel: "email", consents: [{ channel: "email", state: "revoked" }] }).reasons)
      .toEqual(expect.arrayContaining(["channel_opted_out"]));
    expect(evaluateDeliveryEligibility({ contact, channel: "sms", consents: [{ channel: "sms", state: "granted" }], dnd: "on" }).reasons)
      .toEqual(expect.arrayContaining(["do_not_disturb"]));
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
    expect(result.deliveryAllowed).toBe(true);
    expect(statements).toHaveLength(2);
    expect(JSON.stringify(statements)).not.toContain("Private message body");
    expect(statements[0].values[7]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records a provider-accepted delivery without storing the message content", async () => {
    const statements = [];
    const db = { prepare(sql) { return { bind(...values) { statements.push({ sql, values }); return { sql, values }; } }; }, batch: async (batch) => expect(batch).toHaveLength(2) };
    const result = await recordDeliveredAttempt(db, { contactId: "contact-1", actor: "Staff QA", channel: "email", contact, consents: [], content: "Private message body" }, "2026-08-04T12:00:00.000Z");
    expect(result.policyEligible).toBe(true);
    expect(JSON.stringify(statements)).not.toContain("Private message body");
    expect(statements[1].sql).toContain("provider_accepted");
  });
});
