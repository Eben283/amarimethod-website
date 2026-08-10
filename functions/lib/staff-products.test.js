import { describe, expect, it } from "vitest";
import { createStaffProduct, listStaffProducts, posCatalogFromProducts } from "./staff-products.js";
import { normalizeCart } from "./staff-pos.js";

function makeDb() {
  const products = new Map();
  const versions = new Map();
  const requests = new Map();
  const statement = (sql, args = []) => ({
    bind(...next) { return statement(sql, next); },
    async all() {
      if (/FROM staff_products p/i.test(sql)) {
        return { results: [...products.values()].map((product) => ({ ...product, ...versions.get(product.id) })) };
      }
      return { results: [] };
    },
    async first() {
      if (/create_request_id/i.test(sql)) return requests.has(args[0]) ? { id: requests.get(args[0]) } : null;
      if (/lower\(name\)/i.test(sql)) {
        const match = [...versions.values()].find((row) => row.name.toLowerCase() === String(args[0]).toLowerCase() && row.amount_cents === args[1]);
        return match ? { product_id: match.id } : null;
      }
      if (/WHERE p.id/i.test(sql)) {
        const product = products.get(args[0]);
        return product ? { ...product, ...versions.get(product.id) } : null;
      }
      return null;
    },
    async run() { return { success: true }; },
    sql,
    args,
  });
  return {
    prepare: statement,
    async batch(statements) {
      const productArgs = statements[0].args;
      const versionArgs = statements[1].args;
      const [id, requestId, createdAt, createdBy] = productArgs;
      products.set(id, { id, status: "active", version: 1, created_at: createdAt, created_by: createdBy });
      requests.set(requestId, id);
      versions.set(id, {
        id,
        version: 1,
        name: versionArgs[1],
        description: versionArgs[2],
        category: versionArgs[3],
        internal_reason: versionArgs[4],
        amount_cents: versionArgs[5],
        currency: "USD",
        available_in_pos: versionArgs[6],
      });
      return [{ success: true }, { success: true }, { success: true }];
    },
  };
}

const createInput = {
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Movement straps",
  amountCents: 4800,
  category: "retail",
  description: "Pair of practice straps",
  internalReason: "Equipment",
};

describe("owned Staff products", () => {
  it("reports every code-known definition and makes unmapped definitions reference-only", async () => {
    const result = await listStaffProducts(makeDb());
    expect(result.coverage).toMatchObject({
      source: "code-known-reference",
      liveProviderVerified: false,
      counts: {
        knownDefinitions: 18,
        staffCatalog: 11,
        referenceOnly: 7,
        customProducts: 0,
      },
    });
    expect(result.coverage.definitions).toHaveLength(18);
    expect(result.coverage.definitions
      .filter((definition) => definition.staffSaleState === "reference-only")
      .map((definition) => definition.name))
      .toEqual([
        "Upgrade: Initial → 8-Session",
        "Upgrade: Initial → 4-Session",
        "Initial Session — In Person",
        "Initial Session — Virtual",
        "Follow-up Session — In Person",
        "Follow-up Session — Virtual",
        "Pre Purchased session",
      ]);
    const referenceOnly = result.coverage.definitions
      .filter((definition) => definition.staffSaleState === "reference-only");
    expect(referenceOnly.every((definition) => definition.amountCents === null && definition.currency === null)).toBe(true);
    expect(new Set(result.coverage.definitions.map((definition) => definition.name)).size).toBe(18);
    expect(result.coverage.definitions.find((definition) => definition.name === "Initial Session — In Person")).toMatchObject({
      purchaseBehavior: "credit",
      sessions: 1,
      salesPolicy: "reference",
    });
    expect(result.coverage.definitions.find((definition) => definition.name === "Follow-up Session — In Person")).toMatchObject({
      purchaseBehavior: "draw-down",
      sessions: 1,
      salesPolicy: "reference",
    });
    expect(result.coverage.definitions.find((definition) => definition.name === "Amari Assessment")).toMatchObject({
      purchaseBehavior: "no-credit",
      staffSaleState: "ready",
      amountCents: 2900,
    });
  });

  it("does not claim a custom-product count when owned storage cannot be read", async () => {
    expect((await listStaffProducts(null)).coverage.counts.customProducts).toBe(null);
  });

  it("lists the server-owned sellable catalog with current and legacy policy labels", async () => {
    const result = await listStaffProducts(makeDb());
    expect(result.products.find((product) => product.key === "12-week-practice")).toMatchObject({
      name: "12-Week Amari Practice", amountCents: 540000, salesPolicy: "current", fulfillmentMode: "linked",
    });
    expect(result.products.find((product) => product.key === "4-session-series")).toMatchObject({ salesPolicy: "legacy" });
    expect(result.products.find((product) => product.key === "amari-assessment")).toMatchObject({
      availableInPos: true,
      readiness: "ready",
      fulfillmentPolicy: "none",
      readinessReason: null,
    });
    expect(result.products.find((product) => product.key === "entrainment-20")).toMatchObject({
      availableInPos: true,
      readiness: "ready",
      fulfillmentPolicy: "none",
      readinessReason: null,
    });
    expect(result.products.find((product) => product.key === "single-session")).toMatchObject({
      availableInPos: true,
      readiness: "ready",
      fulfillmentPolicy: "session-credit",
      fulfillmentSummary: "One session credit",
    });
    expect(result.products.find((product) => product.key === "living-practice")).toMatchObject({
      availableInPos: true,
      readiness: "ready",
      fulfillmentPolicy: "living-practice-access",
      fulfillmentSummary: "Living Practice access",
    });
    expect(result.products.find((product) => product.key === "entrainment")).toMatchObject({
      availableInPos: false,
      readiness: "needs-fulfillment",
    });
    expect(result.products.some((product) => product.key === "initial-in-person")).toBe(false);
  });

  it("creates an audited immutable simple product with no automatic lifecycle effects", async () => {
    const db = makeDb();
    const product = await createStaffProduct(db, createInput, {
      actor: "Eben",
      id: "12345678-1234-4234-8234-123456789abc",
      now: "2026-08-08T23:00:00.000Z",
    });
    expect(product).toMatchObject({
      key: "custom-12345678-1234-4234-8234-123456789abc",
      name: "Movement straps",
      amountCents: 4800,
      source: "staff-created",
      fulfillmentMode: "manual",
      fulfillmentPolicy: "none",
      createdBy: "Eben",
    });
    expect(product.fulfillmentSummary).toContain("No automatic sessions");
    expect((await listStaffProducts(db)).products).toContainEqual(expect.objectContaining({ key: product.key }));
  });

  it("is idempotent by create request and uses the stored server price in POS", async () => {
    const db = makeDb();
    const first = await createStaffProduct(db, createInput, { actor: "Eben", id: "12345678-1234-4234-8234-123456789abc" });
    const repeated = await createStaffProduct(db, createInput, { actor: "Garrett", id: "22345678-1234-4234-8234-123456789abc" });
    expect(repeated.key).toBe(first.key);
    const catalog = posCatalogFromProducts((await listStaffProducts(db)).products);
    expect(normalizeCart([{ productKey: first.key, quantity: 2 }], catalog)).toEqual([
      expect.objectContaining({ kind: "catalog", label: "Movement straps", unitAmountCents: 4800, lineTotalCents: 9600, fulfillmentPolicy: "none" }),
    ]);
    expect(() => normalizeCart([{ productKey: first.key, amountCents: 1 }], catalog)).toThrow("Unknown cart field");
  });

  it("rejects unknown fulfillment fields, duplicate definitions, and invalid prices", async () => {
    const db = makeDb();
    await createStaffProduct(db, createInput, { actor: "Eben", id: "12345678-1234-4234-8234-123456789abc" });
    await expect(createStaffProduct(db, { ...createInput, requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, {
      actor: "Eben", id: "22345678-1234-4234-8234-123456789abc",
    })).rejects.toMatchObject({ status: 409 });
    await expect(createStaffProduct(db, { ...createInput, requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sessions: 4 }, {
      actor: "Eben", id: "32345678-1234-4234-8234-123456789abc",
    })).rejects.toThrow("Unknown product field");
    await expect(createStaffProduct(db, { ...createInput, requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", amountCents: 0 }, {
      actor: "Eben", id: "42345678-1234-4234-8234-123456789abc",
    })).rejects.toThrow("price");
  });
});
