import { describe, expect, it } from "vitest";
import { checkoutForm, staffCheckoutOffer } from "./staff-stripe-checkout.js";

describe("staff Stripe checkout", () => {
  it("keeps offers server-side and refuses unknown keys", () => {
    expect(staffCheckoutOffer("8-session-series")).toMatchObject({ amountCents: 129500, ghlProductId: "69987357c839790426996114" });
    expect(staffCheckoutOffer("$1")).toBeNull();
  });

  it("creates a card-saving Checkout form with immutable fulfillment metadata", () => {
    const form = checkoutForm({
      customerId: "cus_123",
      contactId: "contact_12345678",
      offerKey: "8-session-series",
      successUrl: "https://example.com/complete",
      cancelUrl: "https://example.com/cancel",
      now: 1_700_000_000_000,
    });
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("129500");
    expect(form.get("customer")).toBe("cus_123");
    expect(form.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
    expect(form.get("metadata[contactId]")).toBe("contact_12345678");
    expect(form.get("metadata[ghlProductId]")).toBe("69987357c839790426996114");
    expect(form.get("payment_intent_data[metadata][source]")).toBe("amari_staff_checkout");
  });

  it("never accepts an unknown offer when creating a Checkout form", () => {
    expect(() => checkoutForm({ customerId: "cus_123", contactId: "contact_12345678", offerKey: "unknown", successUrl: "x", cancelUrl: "y" })).toThrow("Unknown staff checkout offer");
  });
});
