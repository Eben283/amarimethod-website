import { describe, it, expect } from 'vitest';
import { remainingIndicatesUndercredit, findAuditedProduct } from './rules.js';
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
