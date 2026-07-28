import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chargeCustomerCard,
  listCustomerCards,
  resolveProvenStripeCustomer,
  stripeRequest,
  verifyStripeWebhookSignature,
} from "./stripe-api.js";

describe("stripeRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sanitizes invalid API key errors so key fragments are not returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid API Key provided: "Taket************************"' },
        }),
      })),
    );
    await expect(stripeRequest("bad-key", "GET", "/customers")).rejects.toThrow(
      /Update STRIPE_SECRET_KEY/i,
    );
    await expect(stripeRequest("bad-key", "GET", "/customers")).rejects.not.toThrow(/Taket/);
  });
});

describe("resolveProvenStripeCustomer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonOk(body) {
    return { ok: true, status: 200, json: async () => body };
  }

  it("returns null for draft contacts", async () => {
    await expect(resolveProvenStripeCustomer("sk", { contactId: "draft_1" })).resolves.toBeNull();
  });

  it("accepts a stored customer when metadata contactId matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const u = String(url);
        if (u.includes("/payment_methods")) return jsonOk({ data: [] });
        if (u.includes("/customers/search") || u.includes("/charges/search")) return jsonOk({ data: [] });
        return jsonOk({ id: "cus_1", metadata: { contactId: "ghl_1" } });
      }),
    );
    await expect(
      resolveProvenStripeCustomer("sk", { contactId: "ghl_1", storedCustomerId: "cus_1" }),
    ).resolves.toMatchObject({ id: "cus_1" });
  });

  it("rejects a stored customer tied to a different contactId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/customers/cus_wrong")) {
          return jsonOk({ id: "cus_wrong", metadata: { contactId: "other" } });
        }
        return jsonOk({ data: [] });
      }),
    );
    await expect(
      resolveProvenStripeCustomer("sk", { contactId: "ghl_1", storedCustomerId: "cus_wrong" }),
    ).resolves.toBeNull();
  });

  it("resolves via charge metadata.contactId when the Customer has no contactId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = String(url);
        if (u.includes("/customers/search")) return jsonOk({ data: [] });
        if (u.includes("/charges/search")) {
          return jsonOk({
            data: [{ id: "ch_1", customer: "cus_pay", metadata: { contactId: "ghl_1" } }],
          });
        }
        if (u.includes("/payment_methods")) return jsonOk({ data: [] });
        if (u.includes("/customers/cus_pay") && init?.method === "POST") {
          return jsonOk({ id: "cus_pay", metadata: { contactId: "ghl_1" } });
        }
        if (u.includes("/customers/cus_pay")) return jsonOk({ id: "cus_pay", metadata: {} });
        return jsonOk({ data: [] });
      }),
    );
    await expect(resolveProvenStripeCustomer("sk", { contactId: "ghl_1" })).resolves.toMatchObject({
      id: "cus_pay",
    });
  });

  it("resolves via GHL Customer metadata.id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = String(url);
        if (u.includes("/customers/search") && u.includes("contactId")) return jsonOk({ data: [] });
        if (u.includes("/customers/search") && decodeURIComponent(u).includes('metadata["id"]')) {
          return jsonOk({
            data: [{ id: "cus_ghl", metadata: { id: "ghl_1", location: "loc" } }],
          });
        }
        if (u.includes("/payment_methods")) return jsonOk({ data: [] });
        if (u.includes("/charges/search")) return jsonOk({ data: [] });
        if (u.includes("/customers/cus_ghl") && init?.method === "POST") {
          return jsonOk({ id: "cus_ghl", metadata: { id: "ghl_1", contactId: "ghl_1" } });
        }
        if (u.includes("/customers/cus_ghl")) return jsonOk({ id: "cus_ghl", metadata: { id: "ghl_1" } });
        return jsonOk({ data: [] });
      }),
    );
    await expect(resolveProvenStripeCustomer("sk", { contactId: "ghl_1" })).resolves.toMatchObject({
      id: "cus_ghl",
    });
  });

  it("prefers the proven customer that already has a reusable card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const u = String(url);
        if (u.includes("/customers/search") && u.includes("contactId")) {
          return jsonOk({ data: [{ id: "cus_empty", metadata: { contactId: "ghl_1" } }] });
        }
        if (u.includes("/customers/search") && decodeURIComponent(u).includes('metadata["id"]')) {
          return jsonOk({ data: [{ id: "cus_carded", metadata: { id: "ghl_1" } }] });
        }
        if (u.includes("/charges/search")) return jsonOk({ data: [] });
        if (u.includes("/payment_methods") && u.includes("cus_carded")) {
          return jsonOk({
            data: [{ id: "pm_1", card: { brand: "mastercard", last4: "5420", exp_month: 11, exp_year: 2030 } }],
          });
        }
        if (u.includes("/payment_methods")) return jsonOk({ data: [] });
        if (u.includes("/customers/cus_carded")) return jsonOk({ id: "cus_carded", metadata: { id: "ghl_1" }, invoice_settings: {} });
        if (u.includes("/customers/cus_empty")) return jsonOk({ id: "cus_empty", metadata: { contactId: "ghl_1" }, invoice_settings: {} });
        return jsonOk({ data: [] });
      }),
    );
    await expect(resolveProvenStripeCustomer("sk", { contactId: "ghl_1" })).resolves.toMatchObject({
      id: "cus_carded",
    });
  });

  it("does not stop at a stored empty customer when another proven customer has a card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const u = String(url);
        if (u.includes("/customers/cus_empty")) {
          return jsonOk({ id: "cus_empty", metadata: { contactId: "ghl_1" }, invoice_settings: {} });
        }
        if (u.includes("/customers/search") && u.includes("contactId")) {
          return jsonOk({ data: [{ id: "cus_empty", metadata: { contactId: "ghl_1" } }] });
        }
        if (u.includes("/customers/search") && decodeURIComponent(u).includes('metadata["id"]')) {
          return jsonOk({ data: [{ id: "cus_carded", metadata: { id: "ghl_1" } }] });
        }
        if (u.includes("/charges/search")) return jsonOk({ data: [] });
        if (u.includes("/payment_methods") && u.includes("cus_carded")) {
          return jsonOk({
            data: [{ id: "pm_1", card: { brand: "mastercard", last4: "5420", exp_month: 11, exp_year: 2030 } }],
          });
        }
        if (u.includes("/payment_methods")) return jsonOk({ data: [] });
        if (u.includes("/customers/cus_carded")) {
          return jsonOk({ id: "cus_carded", metadata: { id: "ghl_1" }, invoice_settings: {} });
        }
        return jsonOk({ data: [] });
      }),
    );
    await expect(
      resolveProvenStripeCustomer("sk", { contactId: "ghl_1", storedCustomerId: "cus_empty" }),
    ).resolves.toMatchObject({ id: "cus_carded" });
  });
});

describe("listCustomerCards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns safe brand/last4 descriptors only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/payment_methods")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "pm_1",
                  card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "cus_1", invoice_settings: {} }),
        };
      }),
    );
    await expect(listCustomerCards("sk", "cus_1")).resolves.toEqual([
      { id: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
    ]);
  });
});

describe("chargeCustomerCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts an off_session confirmed PaymentIntent", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "pi_1", status: "succeeded" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await chargeCustomerCard("sk", {
      amountCents: 550000,
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      saleId: "pos_1",
      paymentLegId: "leg_1",
      contactId: "ghl_1",
      description: "Practice",
    });
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain("off_session=true");
    expect(body).toContain("confirm=true");
    expect(body).toContain("payment_method=pm_1");
    expect(body).toContain("customer=cus_1");
  });
});

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
