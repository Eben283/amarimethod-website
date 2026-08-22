import { describe, expect, it } from "vitest";
import { verifyGhlWebhookSecret } from "./ghl-webhook-auth.js";

describe("verifyGhlWebhookSecret", () => {
  it("accepts either the current or replacement shared secret", () => {
    const env = { GHL_WEBHOOK_SECRET: "current", GHL_WEBHOOK_SECRET_REPLACEMENT: "replacement" };
    expect(verifyGhlWebhookSecret(env, "current")).toEqual({ configured: true, valid: true });
    expect(verifyGhlWebhookSecret(env, "replacement")).toEqual({ configured: true, valid: true });
    expect(verifyGhlWebhookSecret(env, "wrong")).toEqual({ configured: true, valid: false });
  });

  it("uses a dedicated secret exclusively when one is configured", () => {
    const env = {
      GHL_APPOINTMENT_WEBHOOK_SECRET: "dedicated",
      GHL_WEBHOOK_SECRET: "current",
      GHL_WEBHOOK_SECRET_REPLACEMENT: "replacement",
    };
    expect(verifyGhlWebhookSecret(env, "dedicated", "GHL_APPOINTMENT_WEBHOOK_SECRET")).toEqual({ configured: true, valid: true });
    expect(verifyGhlWebhookSecret(env, "current", "GHL_APPOINTMENT_WEBHOOK_SECRET")).toEqual({ configured: true, valid: false });
  });

  it("fails closed when no secret is configured", () => {
    expect(verifyGhlWebhookSecret({}, "anything")).toEqual({ configured: false, valid: false });
  });
});
