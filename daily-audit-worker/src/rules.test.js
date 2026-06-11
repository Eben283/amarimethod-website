import { describe, it, expect } from 'vitest';
import { remainingIndicatesUndercredit, findAuditedProduct, isUnmappedHighValueOrder, classifyInvoiceItems } from './rules.js';
import { AUDIT_INCREMENT_MAP } from '../../functions/lib/ghl-products.js';

// Real GHL ids (kept in sync with ghl-products.js).
const EIGHT_SERIES_PRODUCT_ID = '69987357c839790426996114'; // 8-Session Series
const UPGRADE_4TO8_PRICE_ID = '6a010952e41b44dab12d3c06';   // a priceId, not a productId
const FOLLOWUP_PRODUCT_ID = '69aee204e80b62d627d8e922';     // single follow-up — not a package
const lineItem = (id) => ({ product: { _id: id } });

describe('findAuditedProduct (R3 — read NESTED item.product._id, scan all items)', () => {
  // Sanity: the ids we test with are actually in the map (guards against drift).
  it('the test productId + priceId resolve in AUDIT_INCREMENT_MAP', () => {
    expect(AUDIT_INCREMENT_MAP[EIGHT_SERIES_PRODUCT_ID]).toBeTruthy();
    expect(AUDIT_INCREMENT_MAP[UPGRADE_4TO8_PRICE_ID]).toBeTruthy();
  });

  it('resolves a package from the NESTED item.product._id (the real order shape)', () => {
    const cfg = findAuditedProduct({ items: [lineItem(EIGHT_SERIES_PRODUCT_ID)] });
    expect(cfg).toBeTruthy();
    expect(cfg.seriesType).toBe('8-session');
  });

  it('resolves via a NESTED item.price._id too (map keyed by both)', () => {
    const cfg = findAuditedProduct({ items: [{ price: { _id: UPGRADE_4TO8_PRICE_ID } }] });
    expect(cfg).toBeTruthy();
  });

  // THE R3 BUG: a package at index 1+ used to be skipped (items[0]-only).
  it('finds the package even when it is NOT the first line item', () => {
    const cfg = findAuditedProduct({ items: [lineItem(FOLLOWUP_PRODUCT_ID), lineItem(EIGHT_SERIES_PRODUCT_ID)] });
    expect(cfg?.seriesType).toBe('8-session');
  });

  it('supports order.lineItems as well as order.items', () => {
    expect(findAuditedProduct({ lineItems: [lineItem(EIGHT_SERIES_PRODUCT_ID)] })).toBeTruthy();
  });

  // The OLD broken read used flat item.productId/item.priceId, which are absent
  // on real orders — proving why the watchdog was blind. Nested-only is correct.
  it('returns null for the old FLAT-field shape (item.productId, no nested product)', () => {
    expect(findAuditedProduct({ items: [{ productId: EIGHT_SERIES_PRODUCT_ID }] })).toBe(null);
  });

  it('returns null when no line item is an audited product', () => {
    expect(findAuditedProduct({ items: [lineItem(FOLLOWUP_PRODUCT_ID)] })).toBe(null);
  });

  it('returns null for empty / missing item lists', () => {
    expect(findAuditedProduct({ items: [] })).toBe(null);
    expect(findAuditedProduct({})).toBe(null);
    expect(findAuditedProduct(null)).toBe(null);
  });
});

// Invoice items carry the ids FLAT (item.productId / item.priceId) — the exact shape
// findAuditedProduct ignores (test above). classifyInvoiceItems adapts flat → nested so
// invoice-billed packages (Betsy's $1,295 8-pack lives only in /invoices/, never in orders)
// are classifiable by the audit.
describe('classifyInvoiceItems (invoice shape — flat productId/priceId)', () => {
  it('classifies an 8-pack from a real invoice item (flat productId) — the exact Betsy shape', () => {
    const cfg = classifyInvoiceItems([{ productId: EIGHT_SERIES_PRODUCT_ID, priceId: 'x', name: '8-Session Series' }]);
    expect(cfg?.seriesType).toBe('8-session');
  });

  it('resolves via the flat priceId too (map keyed by both)', () => {
    expect(classifyInvoiceItems([{ priceId: UPGRADE_4TO8_PRICE_ID }])).toBeTruthy();
  });

  it('finds the package even when it is not the first invoice line item', () => {
    const cfg = classifyInvoiceItems([{ productId: FOLLOWUP_PRODUCT_ID }, { productId: EIGHT_SERIES_PRODUCT_ID }]);
    expect(cfg?.seriesType).toBe('8-session');
  });

  it('returns null for an unmapped / à-la-carte invoice (→ caller flags as catalog gap)', () => {
    expect(classifyInvoiceItems([{ productId: 'unknown-product', priceId: 'unknown-price' }])).toBe(null);
    expect(classifyInvoiceItems([{ productId: FOLLOWUP_PRODUCT_ID }])).toBe(null); // single follow-up = not a package
  });

  it('returns null for empty / missing items', () => {
    expect(classifyInvoiceItems([])).toBe(null);
    expect(classifyInvoiceItems(undefined)).toBe(null);
  });
});

// Regression for the false-CRITICAL "sessions_remaining_not_incremented" alarm
// (session-audit 2026-06-06b). The audit reads a snapshot N hours after the
// purchase, so a legitimately drawn-down balance must NOT be reported as a
// failed credit — only a genuine under-credit should.
describe('remainingIndicatesUndercredit', () => {
  // Garrett's standard protocol: run session → sell 8-pack (SET to 8) → mark the
  // just-run session showed → 8 becomes 7. This must be silent.
  it('does NOT flag an 8-pack that dropped to 7 from a same-day draw', () => {
    expect(remainingIndicatesUndercredit('7', 8)).toBe(false);
  });
  it('does NOT flag an 8-pack at 6 (two same-window draws)', () => {
    expect(remainingIndicatesUndercredit('6', 8)).toBe(false);
  });
  // à-la-carte single: ADD +1, then attended same day → back to 0.
  it('does NOT flag a single follow-up bought and attended to 0', () => {
    expect(remainingIndicatesUndercredit('0', 1)).toBe(false);
  });
  it('does NOT flag a full, untouched package', () => {
    expect(remainingIndicatesUndercredit('8', 8)).toBe(false);
  });

  // Genuine under-credit (the SET never fired) still fires.
  it('FLAGS an 8-pack stuck near zero', () => {
    expect(remainingIndicatesUndercredit('0', 8)).toBe(true);
    expect(remainingIndicatesUndercredit('1', 8)).toBe(true);
  });
  it('FLAGS a missing / unparseable field after a recognized purchase', () => {
    expect(remainingIndicatesUndercredit('', 8)).toBe(true);
    expect(remainingIndicatesUndercredit(undefined, 8)).toBe(true);
  });
});

describe('isUnmappedHighValueOrder (alert — paid order ≥ $400 with no known product)', () => {
  it('flags a paid order at/above the $400 threshold', () => {
    expect(isUnmappedHighValueOrder({ amount: 1295, status: 'paid' })).toBe(true);
    expect(isUnmappedHighValueOrder({ amount: 400, paymentStatus: 'completed' })).toBe(true);
    expect(isUnmappedHighValueOrder({ total: 720, status: 'succeeded' })).toBe(true);
  });
  it('does NOT flag à-la-carte amounts below $400 (LP $347 / initial $225 / follow-up $190)', () => {
    expect(isUnmappedHighValueOrder({ amount: 347, status: 'paid' })).toBe(false);
    expect(isUnmappedHighValueOrder({ amount: 225, status: 'paid' })).toBe(false);
    expect(isUnmappedHighValueOrder({ amount: 190, status: 'completed' })).toBe(false);
  });
  it('does NOT flag unpaid / pending / failed orders (even high-value)', () => {
    expect(isUnmappedHighValueOrder({ amount: 1295, status: 'pending' })).toBe(false);
    expect(isUnmappedHighValueOrder({ amount: 1295, paymentStatus: 'failed' })).toBe(false);
    expect(isUnmappedHighValueOrder({ amount: 1295 })).toBe(false); // no status
  });
  it('handles missing / unparseable amount safely', () => {
    expect(isUnmappedHighValueOrder({ status: 'paid' })).toBe(false);
    expect(isUnmappedHighValueOrder({ amount: 'abc', status: 'paid' })).toBe(false);
    expect(isUnmappedHighValueOrder(null)).toBe(false);
  });
});
