import { describe, expect, it } from "vitest";
import { issueOwnedReceipt, ownedNoEffectCart } from "./staff-pos-receipts.js";

function makeDb() {
  const receipts = new Map();
  const lines = new Map();
  const statement = (sql, args = []) => ({
    bind(...next) { return statement(sql, next); },
    async first() {
      if (/FROM staff_pos_receipts/i.test(sql)) return receipts.get(args[0]) || null;
      return null;
    },
    sql,
    args,
  });
  return {
    receipts,
    lines,
    prepare: statement,
    async batch(statements) {
      const receipt = statements[0].args;
      receipts.set(receipt[1], {
        receipt_id: receipt[0], sale_id: receipt[1], contact_id: receipt[2], customer_name: receipt[3],
        currency: "USD", total_cents: receipt[4], paid_at: receipt[5], issued_at: receipt[6], issued_by: receipt[7],
      });
      lines.set(receipt[0], statements.slice(1).map((entry) => entry.args));
      return statements.map(() => ({ success: true }));
    },
  };
}

const sale = {
  id: "pos_owned1234",
  status: "paid",
  totalCents: 9600,
  client: { id: "contact_owned1234", name: "Jordan Lee" },
  cart: [{
    kind: "catalog",
    productKey: "custom-123",
    productVersion: 1,
    label: "Movement straps",
    quantity: 2,
    unitAmountCents: 4800,
    lineTotalCents: 9600,
    fulfillmentPolicy: "none",
  }],
  paymentLegs: [{ status: "paid", paidAt: "2026-08-08T23:05:00.000Z" }],
};

describe("owned Staff POS receipts", () => {
  it("recognizes legacy one-time items without a fulfillment policy", () => {
    expect(ownedNoEffectCart([{ kind: "custom", ghlProductId: null }])).toBe(true);
  });

  it("recognizes only carts whose every line has no lifecycle effect", () => {
    expect(ownedNoEffectCart(sale.cart)).toBe(true);
    expect(ownedNoEffectCart([...sale.cart, { fulfillmentPolicy: "provider-linked" }])).toBe(false);
    expect(ownedNoEffectCart([])).toBe(false);
  });

  it("issues one immutable receipt from the paid sale snapshot", async () => {
    const db = makeDb();
    const first = await issueOwnedReceipt(db, sale, { actor: "Eben", now: "2026-08-08T23:06:00.000Z", id: "receipt-123" });
    const repeated = await issueOwnedReceipt(db, sale, { actor: "Garrett", now: "2026-08-08T23:07:00.000Z", id: "receipt-456" });

    expect(first).toMatchObject({ receiptId: "receipt-123", saleId: sale.id, totalCents: 9600, issuedBy: "Eben" });
    expect(repeated.receiptId).toBe("receipt-123");
    expect(db.receipts.size).toBe(1);
    expect(db.lines.get("receipt-123")[0]).toEqual(expect.arrayContaining(["Movement straps", 2, 4800, 9600, "none"]));
  });

  it("fails closed without D1 or with a mixed-effect cart", async () => {
    await expect(issueOwnedReceipt(null, sale)).rejects.toThrow("storage");
    await expect(issueOwnedReceipt(makeDb(), { ...sale, cart: [...sale.cart, { fulfillmentPolicy: "provider-linked" }] })).rejects.toThrow("only no-effect");
  });
});
