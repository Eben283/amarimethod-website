import { describe, expect, it } from "vitest";
import {
  attachCheckoutSession,
  buildPosSale,
  markLegPaid,
  normalizeCart,
  normalizePaymentLegs,
  POS_CATALOG,
  recomputeSaleStatus,
} from "./staff-pos.js";

describe("staff POS model", () => {
  it("uses a server-owned catalog and rejects a browser-supplied price", () => {
    expect(POS_CATALOG["12-week-practice"].amountCents).toBe(540000);
    expect(POS_CATALOG["12-week-practice-3000"]).toMatchObject({
      amountCents: 300000,
      ghlProductId: "6a66cde7ef7b07f122ad46fb",
    });
    expect(normalizeCart([{ productKey: "12-week-practice-3000", quantity: 1 }])).toEqual([
      expect.objectContaining({
        kind: "catalog",
        productKey: "12-week-practice-3000",
        unitAmountCents: 300000,
        lineTotalCents: 300000,
        ghlProductId: "6a66cde7ef7b07f122ad46fb",
      }),
    ]);
    expect(POS_CATALOG["amari-assessment"]).toMatchObject({
      amountCents: 2900,
      ghlProductId: "6a66cf0103821ea09ea13f1b",
    });
    expect(normalizeCart([{ productKey: "amari-assessment", quantity: 1 }])).toEqual([
      expect.objectContaining({
        kind: "catalog",
        productKey: "amari-assessment",
        unitAmountCents: 2900,
        lineTotalCents: 2900,
        ghlProductId: "6a66cf0103821ea09ea13f1b",
      }),
    ]);
    expect(() => normalizeCart([{ productKey: "8-session-series", quantity: 1, amountCents: 1 }])).toThrow("Unknown cart field");
  });

  it("permits an explicitly-labelled custom amount but never an unlabelled one", () => {
    expect(normalizeCart([{ customLabel: "Clinical materials", customReason: "Materials", customAmountCents: 2500 }])).toEqual([
      expect.objectContaining({ kind: "custom", label: "Clinical materials", reason: "Materials", unitAmountCents: 2500 }),
    ]);
    expect(() => normalizeCart([{ customAmountCents: 2500 }])).toThrow("Custom item needs a label");
  });

  it("requires payment allocations to equal the calculated cart total", () => {
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

  it("marks a sale paid only after every payment leg settles", () => {
    const sale = buildPosSale({
      id: "pos_abcdefgh",
      client: { id: "contact_abcdefgh", name: "Jordan Lee", email: "j@example.com" },
      cart: [{ productKey: "initial-in-person" }],
      paymentLegs: [
        { method: "hsa-card", amountCents: 10000 },
        { method: "manual-card", amountCents: 12500 },
      ],
      reviewer: "Eben",
    });
    const opened = attachCheckoutSession(sale, "leg-1", { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }, "Eben");
    expect(opened.status).toBe("awaiting_payment");
    const partial = markLegPaid(opened, "leg-1", { paymentIntentId: "pi_1", source: "webhook" });
    expect(partial.status).toBe("partially_paid");
    expect(recomputeSaleStatus(partial)).toBe("partially_paid");
    const paid = markLegPaid(partial, "leg-2", { paymentIntentId: "pi_2", source: "webhook" });
    expect(paid.status).toBe("paid");
    expect(paid.fulfillmentStatus).toBe("pending");
  });
});
