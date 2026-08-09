import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
  verifySessionToken: vi.fn(async () => ({ role: "staff", user: "Eben" })),
}));

import { buildPosSale, posSaleKey } from "../lib/staff-pos.js";
import { onRequestPost, posPaymentActionAvailable } from "./staff-pos-sales.js";

function makeKv(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    values,
    async get(key, type) {
      const value = values.get(key) ?? null;
      return type === "json" && typeof value === "string" ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, value); },
  };
}

describe("Staff POS activation boundary", () => {
  it("blocks every money-taking action while the invoice bridge is disabled", () => {
    for (const action of ["start-checkout", "charge-saved-card", "record-cash", "fulfill"]) {
      expect(posPaymentActionAvailable({}, action)).toBe(false);
      expect(posPaymentActionAvailable({ STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "false" }, action)).toBe(false);
    }
  });

  it("keeps draft/save/preview usable and opens payment only on explicit activation", () => {
    expect(posPaymentActionAvailable({}, "create")).toBe(true);
    expect(posPaymentActionAvailable({}, "save")).toBe(true);
    expect(posPaymentActionAvailable({}, "preview-checkout-text")).toBe(true);
    expect(posPaymentActionAvailable({ STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "true" }, "charge-saved-card")).toBe(true);
  });

  it("allows an owned no-effect sale with receipt D1 and no GHL bridge", () => {
    const sale = {
      cart: [{ fulfillmentPolicy: "none" }],
    };
    expect(posPaymentActionAvailable({ ATTEND_DB: {} }, "start-checkout", sale)).toBe(true);
    expect(posPaymentActionAvailable({}, "start-checkout", sale)).toBe(false);
  });

  it("fails closed for a cart that mixes no-effect and provider-linked products", () => {
    const sale = {
      cart: [
        { fulfillmentPolicy: "none" },
        { fulfillmentPolicy: "provider-linked" },
      ],
    };
    expect(posPaymentActionAvailable({
      ATTEND_DB: {},
      STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "true",
    }, "start-checkout", sale)).toBe(false);
  });

  it("rejects forged client settlement evidence and leaves the stored sale unpaid", async () => {
    const existing = buildPosSale({
      id: "pos_security123",
      client: { id: "contact_security123", name: "Jordan Lee", email: "j@example.com" },
      cart: [{ productKey: "6-week-practice" }],
      paymentLegs: [{ method: "cash", amountCents: 300000 }],
      reviewer: "Eben",
      now: "2026-08-08T23:00:00.000Z",
    });
    const kv = makeKv({ [posSaleKey(existing.id)]: JSON.stringify(existing) });
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-pos-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid" },
        body: JSON.stringify({
          action: "save",
          id: existing.id,
          version: existing.version,
          client: existing.client,
          cart: [{ productKey: "6-week-practice" }],
          paymentLegs: [{
            method: "cash",
            amountCents: 300000,
            status: "paid",
            cashReceivedCents: 300000,
            paidAt: "2026-08-08T23:05:00.000Z",
          }],
        }),
      }),
      env: { JWT_SECRET: "jwt", PORTAL_KV: kv },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Unknown payment allocation field") });
    expect(JSON.parse(kv.values.get(posSaleKey(existing.id))).status).toBe("draft");
  });

  it("resolves a reusable custom product and price from owned D1", async () => {
    const kv = makeKv();
    const productDb = {
      prepare: () => ({
        all: async () => ({ results: [{
          id: "custom-12345678-1234-4234-8234-123456789abc",
          status: "active",
          version: 1,
          name: "Movement straps",
          description: "Pair of practice straps",
          category: "retail",
          internal_reason: "Equipment",
          amount_cents: 4800,
          currency: "USD",
          available_in_pos: 1,
          created_at: "2026-08-08T23:00:00.000Z",
          created_by: "Eben",
        }] }),
      }),
    };
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-pos-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid" },
        body: JSON.stringify({
          action: "create",
          client: { id: "contact_custom123", name: "Jordan Lee", email: "j@example.com" },
          cart: [{ productKey: "custom-12345678-1234-4234-8234-123456789abc", quantity: 2 }],
          paymentLegs: [],
        }),
      }),
      env: { JWT_SECRET: "jwt", PORTAL_KV: kv, ATTEND_DB: productDb },
    });

    expect(response.status).toBe(201);
    expect((await response.json()).sale).toMatchObject({
      totalCents: 9600,
      cart: [expect.objectContaining({ label: "Movement straps", unitAmountCents: 4800, fulfillmentPolicy: "none" })],
    });
  });
});
