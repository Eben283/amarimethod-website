import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
  verifySessionToken: vi.fn(async (token) => ({ role: "staff", user: token === "eben" ? "Eben" : "Garrett" })),
}));

import { onRequestGet, onRequestPost } from "./staff-products.js";

function makeDb() {
  const products = new Map();
  const requests = new Map();
  const statement = (sql, args = []) => ({
    bind(...next) { return statement(sql, next); },
    async all() { return { results: [...products.values()] }; },
    async first() {
      if (/create_request_id/i.test(sql)) return requests.has(args[0]) ? { id: requests.get(args[0]) } : null;
      if (/lower\(name\)/i.test(sql)) return null;
      if (/WHERE p.id/i.test(sql)) return products.get(args[0]) || null;
      return null;
    },
    sql,
    args,
  });
  return {
    prepare: statement,
    async batch(statements) {
      const [id, requestId, createdAt, createdBy] = statements[0].args;
      const version = statements[1].args;
      products.set(id, {
        id, status: "active", version: 1,
        name: version[1], description: version[2], category: version[3], internal_reason: version[4],
        amount_cents: version[5], currency: "USD", available_in_pos: version[6], created_at: createdAt, created_by: createdBy,
      });
      requests.set(requestId, id);
      return [{ success: true }, { success: true }, { success: true }];
    },
  };
}

function context(method, token, body, db = makeDb()) {
  return {
    request: new Request("https://www.amarimethod.com/api/staff-products", {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env: { JWT_SECRET: "jwt", ATTEND_DB: db },
  };
}

const input = {
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Movement straps",
  amountCents: 4800,
  category: "retail",
  description: "Pair of practice straps",
  internalReason: "Equipment",
  availableInPos: true,
};

describe("Staff Products API", () => {
  it("lets either staff member read the owned catalog", async () => {
    const response = await onRequestGet(context("GET", "garrett"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canCreate).toBe(false);
    expect(body.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "12-week-practice", amountCents: 540000 }),
    ]));
    expect(body.products.every((product) => !("ghlProductId" in product))).toBe(true);
    expect(body.coverage).toMatchObject({
      source: "code-known-reference",
      liveProviderVerified: false,
      counts: { knownDefinitions: 18, staffCatalog: 11, referenceOnly: 7 },
    });
    expect(body.coverage.definitions.find((definition) => definition.name === "Initial Session — Virtual")).toMatchObject({
      staffSaleState: "reference-only",
      amountCents: null,
      currency: null,
    });
    expect(JSON.stringify(body.coverage)).not.toMatch(/ghlProductId|providerId|priceId|\b[a-f0-9]{24}\b/i);
    expect((await (await onRequestGet(context("GET", "eben"))).json()).canCreate).toBe(true);
  });

  it("lets Eben create a simple product and derives the actor from the session", async () => {
    const response = await onRequestPost(context("POST", "eben", { ...input, createdBy: "Garrett" }));
    expect(response.status).toBe(400);

    const cleanResponse = await onRequestPost(context("POST", "eben", input));
    expect(cleanResponse.status).toBe(201);
    const body = await cleanResponse.json();
    expect(body.product).toMatchObject({ createdBy: "Eben", fulfillmentPolicy: "none" });
    expect(body.product).not.toHaveProperty("ghlProductId");
  });

  it("keeps product creation Eben-only", async () => {
    const response = await onRequestPost(context("POST", "garrett", input));
    expect(response.status).toBe(403);
  });
});
