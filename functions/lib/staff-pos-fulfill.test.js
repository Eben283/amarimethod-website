import { afterEach, describe, expect, it, vi } from "vitest";
import { completeVerifiedPosSale, fulfillPaidPosSale } from "./staff-pos-fulfill.js";

describe("staff POS fulfillment claims", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues an owned receipt for a no-effect cart without calling GHL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const receipts = new Map();
    const db = {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => /FROM staff_pos_receipts/i.test(sql) ? receipts.get(args[0]) || null : null,
          sql,
          args,
        }),
      }),
      batch: async (statements) => {
        const args = statements[0].args;
        receipts.set(args[1], {
          receipt_id: args[0], sale_id: args[1], contact_id: args[2], customer_name: args[3],
          currency: "USD", total_cents: args[4], paid_at: args[5], issued_at: args[6], issued_by: args[7],
        });
        return statements.map(() => ({ success: true }));
      },
    };
    const sale = {
      id: "pos_ownedreceipt1",
      status: "paid",
      fulfillmentStatus: "pending",
      totalCents: 4800,
      client: { id: "contact_owned1", name: "Jordan Lee" },
      cart: [{
        kind: "catalog", productKey: "custom-123", productVersion: 1,
        label: "Movement straps", quantity: 1, unitAmountCents: 4800,
        lineTotalCents: 4800, fulfillmentPolicy: "none",
      }],
      paymentLegs: [{ id: "leg-1", status: "paid", paidAt: "2026-08-08T23:05:00.000Z" }],
      version: 2,
      audit: [],
    };

    const outcome = await fulfillPaidPosSale({ env: { ATTEND_DB: db } }, sale, { actor: "Eben" });

    expect(outcome.sale).toMatchObject({
      fulfillmentStatus: "fulfilled",
      fulfillment: { adapter: "owned_receipt", effect: "none" },
    });
    expect(outcome.result).toMatchObject({ ok: true, pending: false, receiptId: expect.stringMatching(/^receipt-/) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a mixed fulfillment-policy cart without calling GHL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sale = {
      id: "pos_mixedpolicy1",
      status: "paid",
      fulfillmentStatus: "pending",
      totalCents: 304800,
      client: { id: "contact_mixed1", name: "Jordan Lee" },
      cart: [
        { fulfillmentPolicy: "none", lineTotalCents: 4800 },
        { fulfillmentPolicy: "provider-linked", lineTotalCents: 300000 },
      ],
      paymentLegs: [{ id: "leg-1", status: "paid" }],
    };

    const outcome = await fulfillPaidPosSale({
      env: { ATTEND_DB: {}, STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "true" },
    }, sale);

    expect(outcome.result).toMatchObject({
      ok: false,
      pending: true,
      reason: "mixed_fulfillment_policy",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a paid sale pending and performs no GHL work while the invoice bridge is disabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sale = {
      id: "pos_bridgeoff1",
      status: "paid",
      fulfillmentStatus: "pending",
      client: { id: "contact_bridgeoff1" },
      cart: [],
      paymentLegs: [],
    };

    const outcome = await fulfillPaidPosSale({ env: {} }, sale);

    expect(outcome.sale).toBe(sale);
    expect(outcome.sale.fulfillmentStatus).toBe("pending");
    expect(outcome.result).toMatchObject({
      ok: false,
      pending: true,
      reason: "invoice_bridge_disabled",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mirrors an enabled sale to an invoice but never directly PUTs session/access fields", async () => {
    const kv = new Map();
    const portalKv = {
      get: vi.fn(async (key) => kv.get(key) || null),
      put: vi.fn(async (key, value) => { kv.set(key, value); }),
      delete: vi.fn(async (key) => { kv.delete(key); }),
    };
    const fetchCalls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (options.method === "GET") {
        return { ok: true, status: 200, json: async () => ({ invoices: [] }) };
      }
      if (url.endsWith("/invoices/")) {
        return { ok: true, status: 200, json: async () => ({ _id: "invoice-enabled-1", status: "draft" }) };
      }
      if (url.endsWith("/record-payment")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, invoice: { _id: "invoice-enabled-1", status: "paid", amountPaid: 720 } }),
        };
      }
      throw new Error(`Unexpected request ${url}`);
    }));
    const sale = {
      id: "pos_bridgeenabled1",
      status: "paid",
      fulfillmentStatus: "pending",
      totalCents: 72000,
      client: { id: "contact_bridgeenabled1", name: "Test", phone: "+14155550100", email: "" },
      cart: [{
        kind: "catalog",
        label: "4-Session Series",
        ghlProductId: "69986faa724ecd2343ebaa6e",
        quantity: 1,
        unitAmountCents: 72000,
        lineTotalCents: 72000,
      }],
      paymentLegs: [{ id: "leg-1", status: "paid", method: "saved-card", amountCents: 72000 }],
      version: 1,
      audit: [],
    };

    const outcome = await fulfillPaidPosSale({
      env: {
        PORTAL_KV: portalKv,
        GHL_API_KEY: "test-key",
        STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "true",
      },
    }, sale);

    expect(outcome.sale.fulfillmentStatus).toBe("pending");
    expect(outcome.sale.fulfillment).toMatchObject({
      adapter: "ghl_invoice",
      stage: "verification_pending",
      invoice: { id: "invoice-enabled-1", status: "paid" },
    });
    expect(outcome.result).toMatchObject({ ok: true, pending: true });
    expect(fetchCalls.some((call) => call.options.method === "PUT" && call.url.includes("/contacts/"))).toBe(false);
    expect(portalKv.put).toHaveBeenCalledWith(
      "staff-pos:sale:pos_bridgeenabled1",
      expect.stringContaining("invoice-enabled-1"),
    );
  });

  it("does not report fulfillment success when another attempt only holds the claim", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 0 } }),
        }),
      }),
    };
    const sale = {
      id: "pos_claimheld1",
      status: "paid",
      fulfillmentStatus: "pending",
      client: { id: "contact_claimheld1" },
      cart: [{
        kind: "catalog",
        label: "4-Session Series",
        ghlProductId: "69986faa724ecd2343ebaa6e",
        quantity: 1,
        unitAmountCents: 72000,
        lineTotalCents: 72000,
      }],
      paymentLegs: [],
    };

    const outcome = await fulfillPaidPosSale({ env: {
      ATTEND_DB: db,
      PORTAL_KV: { get: async () => null, put: async () => {} },
      STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "true",
    } }, sale);

    expect(outcome.sale).toBe(sale);
    expect(outcome.sale.fulfillmentStatus).toBe("pending");
    expect(outcome.result).toEqual({
      ok: false,
      duplicate: true,
      reason: "claim_held",
    });
  });

  it("releases the D1 claim after a failed GHL attempt so the sale can be retried", async () => {
    const statements = [];
    const db = {
      prepare: (sql) => {
        statements.push(sql);
        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 1 } }),
          }),
        };
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => "test failure",
    })));
    const sale = {
      id: "pos_retryable1",
      status: "paid",
      fulfillmentStatus: "pending",
      client: { id: "contact_retryable1" },
      cart: [{
        kind: "catalog",
        label: "4-Session Series",
        ghlProductId: "69986faa724ecd2343ebaa6e",
        quantity: 1,
        unitAmountCents: 72000,
        lineTotalCents: 72000,
      }],
      totalCents: 72000,
      paymentLegs: [],
      version: 1,
      audit: [],
    };

    const outcome = await fulfillPaidPosSale({
      env: {
        ATTEND_DB: db,
        PORTAL_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
        GHL_API_KEY: "test-key",
        STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED: "true",
      },
    }, sale);

    expect(outcome.sale.fulfillmentStatus).toBe("failed");
    expect(statements.some((sql) => sql.includes("DELETE FROM processed_events"))).toBe(true);
  });
});

describe("completeVerifiedPosSale", () => {
  const sale = {
    id: "pos_verified1",
    status: "paid",
    fulfillmentStatus: "pending",
    client: { id: "contact_verified1", name: "Test" },
    cart: [{
      kind: "catalog",
      label: "4-Session Series",
      ghlProductId: "69986faa724ecd2343ebaa6e",
      quantity: 1,
      unitAmountCents: 72000,
      lineTotalCents: 72000,
    }],
    fulfillment: {
      adapter: "ghl_invoice",
      stage: "verification_pending",
      invoice: { id: "invoice-verified1", status: "paid" },
    },
    version: 2,
    audit: [],
  };
  const pkg = {
    classification: "4-series",
    seriesType: "4-session",
    sessionsRemaining: 4,
    livingPractice: false,
  };
  const verifiedContact = {
    customFields: [
      { id: "wrQSkx6BhXwDGIn1d0V4", value: "4" },
      { id: "3i93lTkmuAV49s9nh0q8", value: "4-session" },
      { id: "O0xmwyRqeNK2EA1GGGye", value: true },
    ],
  };

  it("marks fulfilled only after the exact invoice and package fields read back", () => {
    const completed = completeVerifiedPosSale(sale, {
      invoice: { id: "invoice-verified1", number: "INV-1", amountPaid: 720 },
      pkg,
      contact: verifiedContact,
      now: "2026-08-05T23:00:00.000Z",
    });
    expect(completed).toMatchObject({
      fulfillmentStatus: "fulfilled",
      fulfilledAt: "2026-08-05T23:00:00.000Z",
      fulfillment: {
        stage: "verified",
        invoice: { id: "invoice-verified1", status: "paid" },
        verifiedEffect: { seriesType: "4-session", sessionsRemaining: 4 },
      },
    });
  });

  it("accepts GHL's one-item checkbox array when verifying portal access", () => {
    const liveShapedContact = {
      customFields: verifiedContact.customFields.map((field) =>
        field.id === "O0xmwyRqeNK2EA1GGGye" ? { ...field, value: [true] } : field,
      ),
    };
    expect(completeVerifiedPosSale(sale, {
      invoice: { id: "invoice-verified1", number: "INV-1", amountPaid: 720 },
      pkg,
      contact: liveShapedContact,
    })).toMatchObject({ fulfillmentStatus: "fulfilled", fulfillment: { stage: "verified" } });
  });

  it("rejects a different invoice or missing downstream field evidence", () => {
    expect(() => completeVerifiedPosSale(sale, {
      invoice: { id: "invoice-other" }, pkg, contact: verifiedContact,
    })).toThrow(/does not match/i);
    expect(() => completeVerifiedPosSale(sale, {
      invoice: { id: "invoice-verified1" }, pkg,
      contact: { customFields: [] },
    })).toThrow(/fields do not match/i);
  });

  it("verifies the exact additive Single Session target without replacing an existing series", () => {
    const singleSale = {
      ...sale,
      id: "pos_verifiedsingle1",
      cart: [{
        kind: "catalog",
        productKey: "single-session",
        label: "Single Session",
        ghlProductId: "6a6b8bb7a1753b65945372f1",
        fulfillmentPolicy: "session-credit",
        quantity: 1,
        unitAmountCents: 28500,
        lineTotalCents: 28500,
      }],
      fulfillment: {
        adapter: "ghl_invoice",
        stage: "effect_target_checkpointed",
        invoice: { id: "invoice-single1", status: "paid" },
        effectTarget: { type: "session_credit", sessionsRemaining: 3 },
      },
    };
    const contact = {
      customFields: [
        { id: "wrQSkx6BhXwDGIn1d0V4", value: "3" },
        { id: "3i93lTkmuAV49s9nh0q8", value: "12-week" },
        { id: "O0xmwyRqeNK2EA1GGGye", value: true },
      ],
    };

    expect(completeVerifiedPosSale(singleSale, {
      invoice: { id: "invoice-single1", amountPaid: 285 },
      pkg: { name: "Single Session", classification: "followup", effect: "session_credit", sessionsRemaining: 3 },
      contact,
    })).toMatchObject({
      fulfillmentStatus: "fulfilled",
      fulfillment: {
        stage: "verified",
        verifiedEffect: { type: "session_credit", sessionsAdded: 1, sessionsRemaining: 3 },
      },
    });
  });

  it("verifies standalone Living Practice access without changing the session balance", () => {
    const accessSale = {
      ...sale,
      id: "pos_verifiedliving1",
      cart: [{
        kind: "catalog",
        productKey: "living-practice",
        label: "Living Practice",
        ghlProductId: "6998d7f2606fa79c54fa3ff5",
        fulfillmentPolicy: "living-practice-access",
        quantity: 1,
        unitAmountCents: 34700,
        lineTotalCents: 34700,
      }],
      fulfillment: {
        adapter: "ghl_invoice",
        stage: "verification_pending",
        invoice: { id: "invoice-living1", status: "paid" },
      },
    };
    const contact = {
      customFields: [
        { id: "O0xmwyRqeNK2EA1GGGye", value: true },
        { id: "1EnVtI70jC5MTshZjWvw", value: true },
      ],
    };

    expect(completeVerifiedPosSale(accessSale, {
      invoice: { id: "invoice-living1", amountPaid: 347 },
      pkg: { name: "Living Practice", classification: "living-practice", effect: "living_practice_access" },
      contact,
    })).toMatchObject({
      fulfillmentStatus: "fulfilled",
      fulfillment: {
        stage: "verified",
        verifiedEffect: { type: "living_practice_access", portalAccess: true, livingPractice: true },
      },
    });
  });
});
