export function ownedNoEffectLine(line) {
  return line?.fulfillmentPolicy === "none"
    || (line?.kind === "custom" && !line?.ghlProductId);
}

export function ownedNoEffectCart(cart) {
  return Array.isArray(cart) && cart.length > 0 && cart.every(ownedNoEffectLine);
}

function mapReceipt(row) {
  return {
    receiptId: row.receipt_id,
    saleId: row.sale_id,
    contactId: row.contact_id || null,
    customerName: row.customer_name,
    currency: row.currency,
    totalCents: Number(row.total_cents),
    paidAt: row.paid_at,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
  };
}

export async function issueOwnedReceipt(db, sale, { actor = "Staff POS", now, id } = {}) {
  if (!db) throw new Error("Owned receipt storage is not configured");
  if (!sale?.id || sale.status !== "paid") throw new Error("Only a paid sale can receive a receipt");
  if (!ownedNoEffectCart(sale.cart)) throw new Error("Owned receipts accept only no-effect product carts");
  const lineTotal = sale.cart.reduce((sum, line) => sum + Number(line.lineTotalCents || 0), 0);
  if (!Number.isSafeInteger(sale.totalCents) || sale.totalCents < 1 || lineTotal !== sale.totalCents) {
    throw new Error("Receipt lines do not match the paid sale total");
  }

  const existing = await db.prepare(`
    SELECT receipt_id, sale_id, contact_id, customer_name, currency,
           total_cents, paid_at, issued_at, issued_by
      FROM staff_pos_receipts WHERE sale_id = ?
  `).bind(sale.id).first();
  if (existing) return mapReceipt(existing);

  const issuedAt = now || new Date().toISOString();
  const paidAt = (sale.paymentLegs || [])
    .filter((leg) => leg?.status === "paid" && leg?.paidAt)
    .map((leg) => leg.paidAt)
    .sort()
    .at(-1) || issuedAt;
  const receiptId = id || `receipt-${crypto.randomUUID()}`;
  const issuedBy = String(actor || "Staff POS").trim().slice(0, 80) || "Staff POS";
  const statements = [
    db.prepare(`
      INSERT INTO staff_pos_receipts
        (receipt_id, sale_id, contact_id, customer_name, currency,
         total_cents, paid_at, issued_at, issued_by)
      VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?)
    `).bind(
      receiptId,
      sale.id,
      sale.client?.id || null,
      String(sale.client?.name || "Customer").slice(0, 160),
      sale.totalCents,
      paidAt,
      issuedAt,
      issuedBy,
    ),
    ...sale.cart.map((line, index) => db.prepare(`
      INSERT INTO staff_pos_receipt_lines
        (receipt_id, line_index, product_id, product_version, label, quantity,
         unit_amount_cents, line_total_cents, fulfillment_policy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      receiptId,
      index,
      String(line.productKey || "").startsWith("custom-") ? line.productKey : null,
      Number.isInteger(line.productVersion) ? line.productVersion : null,
      String(line.label || "").slice(0, 160),
      line.quantity,
      line.unitAmountCents,
      line.lineTotalCents,
      "none",
    )),
  ];
  try {
    await db.batch(statements);
  } catch (cause) {
    const repeated = await db.prepare(`
      SELECT receipt_id, sale_id, contact_id, customer_name, currency,
             total_cents, paid_at, issued_at, issued_by
        FROM staff_pos_receipts WHERE sale_id = ?
    `).bind(sale.id).first();
    if (repeated) return mapReceipt(repeated);
    throw cause;
  }
  return {
    receiptId,
    saleId: sale.id,
    contactId: sale.client?.id || null,
    customerName: sale.client?.name || "Customer",
    currency: "USD",
    totalCents: sale.totalCents,
    paidAt,
    issuedAt,
    issuedBy,
  };
}
