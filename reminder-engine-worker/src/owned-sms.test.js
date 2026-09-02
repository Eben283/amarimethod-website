import { describe, expect, it, vi } from "vitest";
import { ownedSmsConfigured, sendOwnedSms, validOwnedSmsRecipient } from "./owned-sms.js";

describe("provider-neutral owned SMS edge", () => {
  it("requires a bound service, shared authentication, and E.164 destination", async () => {
    expect(ownedSmsConfigured({})).toBe(false);
    expect(validOwnedSmsRecipient("contact-provider-id")).toBe(false);
    expect(validOwnedSmsRecipient("+14155550123")).toBe(true);
    await expect(sendOwnedSms({}, { to: "+14155550123", text: "Hello", idempotencyKey: "effect-1" }))
      .resolves.toEqual({ success: false, error: "owned SMS provider is unavailable" });
  });

  it("sends only the bounded command contract and returns an opaque receipt", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, messageId: "sms-receipt-1" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const result = await sendOwnedSms({ OWNED_SMS: { fetch }, WORKER_AUTH_SECRET: "shared-secret" }, {
      to: "+14155550123", text: "Hello", idempotencyKey: "effect-1",
    });
    expect(result).toEqual({ success: true, messageId: "sms-receipt-1" });
    expect(fetch).toHaveBeenCalledWith("https://owned-sms/messages", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer shared-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ to: "+14155550123", text: "Hello", idempotencyKey: "effect-1" }),
    }));
  });

  it("does not treat a provider rejection as accepted delivery", async () => {
    const fetch = async () => new Response(JSON.stringify({ success: false }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
    await expect(sendOwnedSms({ OWNED_SMS: { fetch }, WORKER_AUTH_SECRET: "shared-secret" }, {
      to: "+14155550123", text: "Hello", idempotencyKey: "effect-1",
    })).resolves.toEqual({ success: false, error: "owned SMS provider rejected the command (503)" });
  });
});
