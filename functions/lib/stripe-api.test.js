import { describe, expect, it } from "vitest";
import { verifyStripeWebhookSignature } from "./stripe-api.js";

describe("verifyStripeWebhookSignature", () => {
  it("accepts a valid HMAC signature", async () => {
    const secret = "whsec_test_secret";
    const body = "{\"id\":\"evt_1\",\"type\":\"checkout.session.completed\"}";
    const t = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    await expect(verifyStripeWebhookSignature(body, `t=${t},v1=${hex}`, secret)).resolves.toBe(true);
  });

  it("rejects a bad signature", async () => {
    const body = "{\"id\":\"evt_1\"}";
    const t = Math.floor(Date.now() / 1000);
    await expect(verifyStripeWebhookSignature(body, `t=${t},v1=${"ab".repeat(32)}`, "whsec_test_secret")).resolves.toBe(false);
  });
});
