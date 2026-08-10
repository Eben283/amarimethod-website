import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessPosInvoiceSupport,
  buildPosInvoiceRequest,
  mirrorPaidPosSaleToGhlInvoice,
} from "./staff-pos-invoice-bridge.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Staff POS GHL invoice bridge", () => {
  it("refuses owned no-effect products so they cannot leak into GHL invoices", () => {
    expect(assessPosInvoiceSupport([{
      kind: "catalog",
      productKey: "custom-123",
      label: "Movement straps",
      ghlProductId: null,
      fulfillmentPolicy: "none",
      quantity: 1,
      unitAmountCents: 4800,
      lineTotalCents: 4800,
    }])).toMatchObject({
      supported: false,
      reasons: [expect.stringContaining("owned no-effect")],
    });
  });

  it("builds a no-send GHL invoice from immutable catalog and custom cart lines", () => {
    const request = buildPosInvoiceRequest({
      id: "pos_invoiceplan1",
      status: "paid",
      totalCents: 72450,
      client: {
        id: "contact_invoiceplan1",
        name: "Test Practice Member",
        phone: "+14155550100",
        email: "test@example.com",
      },
      cart: [
        {
          kind: "catalog",
          label: "4-Session Series",
          ghlProductId: "69986faa724ecd2343ebaa6e",
          quantity: 1,
          unitAmountCents: 72000,
          lineTotalCents: 72000,
        },
        {
          kind: "custom",
          label: "Printed materials",
          ghlProductId: null,
          quantity: 1,
          unitAmountCents: 450,
          lineTotalCents: 450,
        },
      ],
    }, { issueDate: "2026-08-05" });

    expect(request).toMatchObject({
      altId: "7pIO7FHVAyBT1jKGhfQM",
      altType: "location",
      name: "Staff POS pos_invoiceplan1",
      currency: "USD",
      issueDate: "2026-08-05",
      liveMode: true,
      discount: { type: "fixed", value: 0 },
      sentTo: { email: [] },
      contactDetails: {
        id: "contact_invoiceplan1",
        name: "Test Practice Member",
        phoneNo: "+14155550100",
        email: "test@example.com",
      },
    });
    expect(request.items).toEqual([
      expect.objectContaining({
        name: "4-Session Series",
        currency: "USD",
        amount: 720,
        qty: 1,
        productId: "69986faa724ecd2343ebaa6e",
        priceId: "69986faa724ecd4f9debaa73",
      }),
      {
        name: "Printed materials",
        currency: "USD",
        amount: 4.5,
        qty: 1,
      },
    ]);
    expect(JSON.stringify(request)).toContain("pos_invoiceplan1");
  });

  it("supports the exact Single Session and Living Practice effects while refusing unresolved catalog effects", () => {
    const line = (ghlProductId, quantity = 1, fulfillmentPolicy = "provider-linked") => ({
      kind: "catalog",
      label: "Test item",
      ghlProductId,
      fulfillmentPolicy,
      quantity,
      unitAmountCents: 100,
      lineTotalCents: 100 * quantity,
    });

    expect(assessPosInvoiceSupport([])).toMatchObject({ supported: false, effect: "needs_review" });

    expect(assessPosInvoiceSupport([
      line("69986faa724ecd2343ebaa6e"),
      { kind: "custom", label: "No fulfillment", quantity: 1, unitAmountCents: 100, lineTotalCents: 100 },
    ])).toMatchObject({
      supported: false,
      reasons: [expect.stringContaining("owned no-effect")],
    });

    for (const cart of [
      [line("6a010952e41b442c862d3c01")], // additive 4→8 upgrade
      [line("6998ace59dfde469ecb2aab6")], // legacy individual session credit
      [line("69986faa724ecd2343ebaa6e", 2)], // package quantity > 1
      [line("69986faa724ecd2343ebaa6e"), line("69987357c839790426996114")],
    ]) {
      expect(assessPosInvoiceSupport(cart)).toMatchObject({ supported: false, effect: "needs_review" });
    }

    expect(assessPosInvoiceSupport([
      line("6a66cf0103821ea09ea13f1b"), // assessment: paid evidence, no session/access credit
      { kind: "custom", label: "No fulfillment", quantity: 1, unitAmountCents: 100, lineTotalCents: 100 },
    ])).toMatchObject({ supported: false, effect: "needs_review" });

    expect(assessPosInvoiceSupport([
      line("6a6b8bb7a1753b65945372f1", 1, "session-credit"),
    ])).toMatchObject({
      supported: true,
      effect: "session_credit",
      sessionCredits: 1,
      productId: "6a6b8bb7a1753b65945372f1",
    });
    expect(assessPosInvoiceSupport([
      line("6998d7f2606fa79c54fa3ff5", 1, "living-practice-access"),
    ])).toMatchObject({
      supported: true,
      effect: "living_practice_access",
      productId: "6998d7f2606fa79c54fa3ff5",
    });
    expect(assessPosInvoiceSupport([
      line("6998d7f2606fa79c54fa3ff5", 2, "living-practice-access"),
    ])).toMatchObject({ supported: false, effect: "needs_review" });
    expect(assessPosInvoiceSupport([
      line("69c5d29c4019ce8e80e2513b"),
    ])).toMatchObject({
      supported: false,
      effect: "needs_review",
      reasons: [expect.stringContaining("no supported Staff POS fulfillment effect")],
    });
  });

  it("places the one supported package first so the current ledger cannot miss it", () => {
    const request = buildPosInvoiceRequest({
      id: "pos_packageorder1",
      status: "paid",
      totalCents: 72100,
      client: { id: "contact_packageorder1", name: "Test", phone: "+14155550100", email: "" },
      cart: [
        { kind: "custom", label: "Custom", quantity: 1, unitAmountCents: 100, lineTotalCents: 100 },
        {
          kind: "catalog",
          label: "4-Session Series",
          ghlProductId: "69986faa724ecd2343ebaa6e",
          quantity: 1,
          unitAmountCents: 72000,
          lineTotalCents: 72000,
        },
      ],
    }, { issueDate: "2026-08-05" });

    expect(request.items[0].productId).toBe("69986faa724ecd2343ebaa6e");
    expect(request.items[1].name).toBe("Custom");
  });

  it("creates a recoverable draft, checkpoints its ID, then records the proven external payment", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "GET") {
        return { ok: true, status: 200, json: async () => ({ invoices: [] }) };
      }
      if (url.endsWith("/invoices/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ _id: "invoice-pos-1", status: "draft", amountPaid: 0 }),
        };
      }
      if (url.endsWith("/invoices/invoice-pos-1/record-payment")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            invoice: { _id: "invoice-pos-1", status: "paid", amountPaid: 720, amountDue: 0 },
          }),
        };
      }
      throw new Error(`Unexpected request ${url}`);
    }));
    const checkpoint = vi.fn(async () => {});
    const sale = {
      id: "pos_invoicecall1",
      status: "paid",
      totalCents: 72000,
      client: {
        id: "contact_invoicecall1",
        name: "Test Practice Member",
        phone: "+14155550100",
        email: "test@example.com",
      },
      cart: [{
        kind: "catalog",
        label: "4-Session Series",
        ghlProductId: "69986faa724ecd2343ebaa6e",
        quantity: 1,
        unitAmountCents: 72000,
        lineTotalCents: 72000,
      }],
    };

    const result = await mirrorPaidPosSaleToGhlInvoice(
      { env: { GHL_API_KEY: "test-key" } },
      sale,
      { onInvoiceIdentified: checkpoint, issueDate: "2026-08-05" },
    );

    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      invoiceId: "invoice-pos-1",
      stage: "invoice_created",
    }));
    expect(result).toMatchObject({
      stage: "payment_recorded",
      invoiceId: "invoice-pos-1",
      invoiceStatus: "paid",
      effect: "package",
    });
    const posts = calls.filter((call) => call.options.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.every((call) => call.options.headers.Version === "v3")).toBe(true);
    const paymentBody = JSON.parse(posts[1].options.body);
    expect(paymentBody).toMatchObject({
      altId: "7pIO7FHVAyBT1jKGhfQM",
      altType: "location",
      mode: "other",
      amount: 720,
    });
    expect(paymentBody.card).toBeUndefined();
    expect(paymentBody.cheque).toBeUndefined();
  });

  it("reuses an already-paid invoice with the sale marker and never records payment twice", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ invoices: [{
        _id: "invoice-existing-paid",
        status: "paid",
        amountPaid: 720,
        name: "Staff POS pos_recoverpaid1",
      }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const sale = {
      id: "pos_recoverpaid1",
      status: "paid",
      totalCents: 72000,
      client: { id: "contact_recoverpaid1", name: "Test", phone: "+14155550100", email: "" },
      cart: [{
        kind: "catalog",
        label: "4-Session Series",
        ghlProductId: "69986faa724ecd2343ebaa6e",
        quantity: 1,
        unitAmountCents: 72000,
        lineTotalCents: 72000,
      }],
    };

    const result = await mirrorPaidPosSaleToGhlInvoice(
      { env: { GHL_API_KEY: "test-key" } },
      sale,
    );

    expect(result).toMatchObject({
      invoiceId: "invoice-existing-paid",
      invoiceStatus: "paid",
      recovered: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
