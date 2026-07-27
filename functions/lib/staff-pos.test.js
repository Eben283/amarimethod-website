import { describe, expect, it } from "vitest";
import { buildPosSale, normalizeCart, normalizeClient, normalizePaymentLegs, POS_CATALOG } from "./staff-pos.js";

describe("staff POS model", () => {
  it("uses a server-owned catalog and rejects a browser-supplied price", () => {
    expect(POS_CATALOG["12-week-practice"].amountCents).toBe(550000);
    expect(POS_CATALOG.entrainment).toMatchObject({ amountCents: 9000, label: "Entrainment" });
    expect(() => normalizeCart([{ productKey: "8-session-series", quantity: 1, amountCents: 1 }])).toThrow("Unknown cart field");
  });

  it("permits an explicitly-labelled custom amount but never an unlabelled one", () => {
    expect(normalizeCart([{ customLabel: "Clinical materials", customReason: "Materials", customAmountCents: 2500 }])).toEqual([
      expect.objectContaining({ kind: "custom", label: "Clinical materials", reason: "Materials", unitAmountCents: 2500 }),
    ]);
    expect(() => normalizeCart([{ customAmountCents: 2500 }])).toThrow("Custom item needs a label");
  });

  it("requires payment allocations to equal the calculated cart total", () => {
    const cart = normalizeCart([{ productKey: "initial-in-person" }]);
    expect(() => normalizePaymentLegs([{ method: "hsa-card", amountCents: 20000 }], 22500)).toThrow("must equal the sale total");
    expect(normalizePaymentLegs([
      { method: "hsa-card", amountCents: 3000 },
      { method: "checkout-link", amountCents: 19500 },
    ], 22500)).toHaveLength(2);
    expect(buildPosSale({
      id: "pos_12345678",
      client: { id: "contact_12345678", name: "Jordan Lee", phone: "+15551234567" },
      cart: [{ productKey: "initial-in-person" }],
      paymentLegs: [{ method: "checkout-link", amountCents: 22500 }],
      reviewer: "Eben",
      now: "2026-07-27T12:00:00.000Z",
    })).toMatchObject({ totalCents: 22500, status: "draft", version: 1 });
  });

  it("keeps new-client contact details in a draft without needing a live CRM write", () => {
    expect(normalizeClient({ id: "draft_12345678", name: "New Client", phone: "+15551234567", email: "NEW@EXAMPLE.COM" }))
      .toMatchObject({ id: "draft_12345678", name: "New Client", phone: "+15551234567", email: "new@example.com" });
    expect(() => normalizeClient({ id: "draft_12345678", name: "New Client" })).toThrow("phone number or email");
  });
});
