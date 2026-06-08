import { describe, it, expect } from 'vitest';
import { PRODUCT_MAP, KV_TTL_SECONDS, resolveOrderProductId } from './ghl-purchase-webhook.js';

const PID = {
  // package purchases (SET sessions_remaining)
  fourSeries: '69986faa724ecd2343ebaa6e',
  eightSeries: '69987357c839790426996114',
  // à-la-carte standalone follow-up ($190) — SHOULD credit +1 (ADD)
  singleFollowupSession: '6998ace59dfde469ecb2aab6',
  retiredFollowup: '67f57171b6b1019c7b0233cc',
  // draw-down / booking products — ride on a booking against an existing
  // package; crediting them would inflate the balance. Must NEVER be credited.
  // (Classifications confirmed with Eben 2026-06-05.)
  followupInPerson: '69aee204e80b62d627d8e922',
  followupVirtual: '69aee3ebcf9cf8ed9f6c928d',
  prePurchasedSession: '67b1299f080422451447bdd0',
};

describe('PRODUCT_MAP — purchase crediting', () => {
  it('credits the à-la-carte Single Follow-up Session (+1, no series change)', () => {
    const p = PRODUCT_MAP[PID.singleFollowupSession];
    expect(p).toBeDefined();
    expect(p.sessionsToAdd).toBe(1);
    expect(p.seriesType).toBe(null);
  });

  it('credits package series with the right session counts', () => {
    expect(PRODUCT_MAP[PID.fourSeries].sessionsToAdd).toBe(4);
    expect(PRODUCT_MAP[PID.eightSeries].sessionsToAdd).toBe(8);
  });

  // The trap: a future "add the missing follow-up IDs" change would inflate
  // sessions_remaining on every booking. These three are draw-downs, not
  // purchases — they must stay out of the credit map.
  it('NEVER credits draw-down / booking products', () => {
    expect(PRODUCT_MAP[PID.followupInPerson]).toBeUndefined();
    expect(PRODUCT_MAP[PID.followupVirtual]).toBeUndefined();
    expect(PRODUCT_MAP[PID.prePurchasedSession]).toBeUndefined();
  });
});

describe('KV idempotency TTL', () => {
  // The idempotency record must outlive GHL's webhook retry window. If it
  // expires first, a late re-delivery of a single follow-up (ADD semantics)
  // re-reads the already-incremented balance and adds again → a free ~$190
  // session. Invoice webhook uses 30d, reconcile 90d — this must not be the
  // short outlier. (session-tracking-audit-2026-06-06, risk #1)
  it('outlives the GHL retry window (>= 30 days)', () => {
    expect(KV_TTL_SECONDS).toBeGreaterThanOrEqual(30 * 86400);
  });
});

describe('resolveOrderProductId (R4 — fetchRecentOrder backup reads NESTED ids)', () => {
  // Real GHL orders carry the product id at item.product._id (productId) and
  // item.price._id (priceId). The old extraction never read item.product._id
  // and treated item._id (the line-item id) as a product, so the Orders-API
  // backup couldn't resolve a real order and silently skipped crediting.
  const UPGRADE_4TO8_PRICE = '6a010952e41b44dab12d3c06'; // priceId → normalizes to productId below
  const UPGRADE_4TO8_PRODUCT = '6a010952e41b442c862d3c01';
  const li = (id) => ({ product: { _id: id } });

  it('resolves a credited package from the nested item.product._id', () => {
    expect(resolveOrderProductId({ items: [li(PID.eightSeries)] })).toBe(PID.eightSeries);
  });

  it('normalizes a nested item.price._id (priceId) to its productId', () => {
    expect(resolveOrderProductId({ items: [{ price: { _id: UPGRADE_4TO8_PRICE } }] })).toBe(UPGRADE_4TO8_PRODUCT);
  });

  it('finds the package even when it is not the first line item', () => {
    expect(resolveOrderProductId({ items: [li(PID.followupInPerson), li(PID.eightSeries)] })).toBe(PID.eightSeries);
  });

  it('does NOT treat item._id (the line-item id) as a product', () => {
    expect(resolveOrderProductId({ items: [{ _id: PID.eightSeries }] })).toBe(null);
  });

  it('returns null for a draw-down-only order (correctly NOT credited)', () => {
    expect(resolveOrderProductId({ items: [li(PID.followupInPerson)] })).toBe(null);
  });

  it('supports lineItems alias + empty/missing', () => {
    expect(resolveOrderProductId({ lineItems: [li(PID.fourSeries)] })).toBe(PID.fourSeries);
    expect(resolveOrderProductId({ items: [] })).toBe(null);
    expect(resolveOrderProductId({})).toBe(null);
    expect(resolveOrderProductId(null)).toBe(null);
  });
});
