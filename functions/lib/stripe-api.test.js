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

  it("returns null for draft contacts", async () => {
    await expect(resolveProvenStripeCustomer("sk", { contactId: "draft_1" })).resolves.toBeNull();
  });

  it("accepts a stored customer when metadata contactId matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "cus_1", metadata: { contactId: "ghl_1" } }),
      })),
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
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "cus_wrong", metadata: { contactId: "other" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        };
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
        if (u.includes("/customers/search")) {
          return { ok: true, status: 200, json: async () => ({ data: [] }) };
        }
        if (u.includes("/charges/search")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: "ch_1", customer: "cus_pay", metadata: { contactId: "ghl_1" } }],
            }),
          };
        }
        if (u.includes("/customers/cus_pay") && (!init || init.method === "GET" || !init.method)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "cus_pay", metadata: {} }),
          };
        }
        if (u.includes("/customers/cus_pay") && init?.method === "POST") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "cus_pay", metadata: { contactId: "ghl_1" } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }),
    );
    await expect(resolveProvenStripeCustomer("sk", { contactId: "ghl_1" })).resolves.toMatchObject({
      id: "cus_pay",
    });
  });
});

describe("listCustomerCards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns safe brand/last4 descriptors only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
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
      })),
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
