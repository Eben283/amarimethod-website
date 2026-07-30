import { describe, it, expect } from 'vitest';
import { PRODUCT_MAP, PAID_BOOKING_MAP, KV_TTL_SECONDS, resolveOrderProductId, isCreditableOrder } from './ghl-purchase-webhook.js';
import { claimProcessedEvent } from '../lib/processed-events.js';

const PID = {
  // package purchases (SET sessions_remaining)
  fourSeries: '69986faa724ecd2343ebaa6e',
  eightSeries: '69987357c839790426996114',
  twelveWeek: '6a66cde7ef7b07f122ad46fb',
  twelveWeekPrice: '6a66cde7ef7b076d15ad4700',
  sixWeek: '6a683360017263178d05d1a3',
  sixWeekPrice: '6a683360017263ef8a05d1a7',
  // à-la-carte standalone follow-up ($190 Founder's Circle) — SHOULD credit +1 (ADD)
  singleFollowupSession: '6998ace59dfde469ecb2aab6',
  // default raised single ($285) — same credit + native-book path
  singleSession285: '6a6b8bb7a1753b65945372f1',
  singleSession285Price: '6a6b8bb7a1753b0f3f5372f5',
  retiredFollowup: '67f57171b6b1019c7b0233cc',
  // draw-down / booking products — ride on a booking against an existing
  // package; crediting them would inflate the balance. Must NEVER be credited.
  // (Classifications confirmed with Eben 2026-06-05.)
  followupInPerson: '69aee204e80b62d627d8e922',
  followupVirtual: '69aee3ebcf9cf8ed9f6c928d',
  prePurchasedSession: '67b1299f080422451447bdd0',
  assessment: '6a66cf0103821ea09ea13f1b',
  assessmentPrice: '6a66cf0103821e836fa13f20',
};

describe('PRODUCT_MAP — purchase crediting', () => {
  it('credits the à-la-carte Single Follow-up Session (+1, no series change)', () => {
    const p = PRODUCT_MAP[PID.singleFollowupSession];
    expect(p).toBeDefined();
    expect(p.sessionsToAdd).toBe(1);
    expect(p.seriesType).toBe(null);
  });

  it('credits the raised $285 Single Session (+1) and native-books like $190', () => {
    expect(PRODUCT_MAP[PID.singleSession285]).toMatchObject({
      sessionsToAdd: 1,
      seriesType: null,
      isNativePaidBooking: true,
      allowRequestedCalendar: true,
    });
    expect(resolveOrderProductId({ items: [{ price: { _id: PID.singleSession285Price } }] })).toBe(PID.singleSession285);
  });

  it('credits package series with the right session counts', () => {
    expect(PRODUCT_MAP[PID.fourSeries].sessionsToAdd).toBe(4);
    expect(PRODUCT_MAP[PID.eightSeries].sessionsToAdd).toBe(8);
    expect(PRODUCT_MAP[PID.twelveWeek]).toMatchObject({ sessionsToAdd: 24, seriesType: '12-week', livingPractice: true });
    expect(PRODUCT_MAP[PID.sixWeek]).toMatchObject({ sessionsToAdd: 12, seriesType: '6-week', livingPractice: true });
  });

  // The trap: a future "add the missing follow-up IDs" change would inflate
  // sessions_remaining on every booking. These three are draw-downs, not
  // purchases — they must stay out of the credit map.
  it('NEVER credits draw-down / booking products', () => {
    expect(PRODUCT_MAP[PID.followupInPerson]).toBeUndefined();
    expect(PRODUCT_MAP[PID.followupVirtual]).toBeUndefined();
    expect(PRODUCT_MAP[PID.prePurchasedSession]).toBeUndefined();
    expect(PRODUCT_MAP[PID.assessment]).toBeUndefined();
    expect(PAID_BOOKING_MAP[PID.assessment]).toMatchObject({
      isNativePaidBooking: true,
      isNonCreditBooking: true,
      calendarId: 'EM6vB2mq7EAdGCbUb3j1',
      durationMinutes: 40,
    });
    // Existing $190 Single Follow-up — credits +1 AND native-books from requested slot.
    expect(PRODUCT_MAP[PID.singleFollowupSession]).toMatchObject({
      isNativePaidBooking: true,
      sessionsToAdd: 1,
      allowRequestedCalendar: true,
    });
    expect(PAID_BOOKING_MAP[PID.singleFollowupSession].duplicateCalendarIds).toEqual([
      'SKDVOL8wtUN6Ne0ppbC9',
      'oVn77FcecFY16iS2pHyP',
    ]);
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
  it('resolves the 12-week practice from its current price id', () => {
    expect(resolveOrderProductId({ items: [{ price: { _id: PID.twelveWeekPrice } }] })).toBe(PID.twelveWeek);
  });
  it('resolves the 6-week practice from its current price id', () => {
    expect(resolveOrderProductId({ items: [{ price: { _id: PID.sixWeekPrice } }] })).toBe(PID.sixWeek);
  });
  it('resolves the Assessment from its current $29 price id for fulfillment, not session crediting', () => {
    expect(resolveOrderProductId({ items: [{ price: { _id: PID.assessmentPrice } }] })).toBe(PID.assessment);
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

// H3 (2026-06-11 review): the Orders-API fallback (fetchRecentOrder) walked a
// contact's recent orders and credited the first with a recognized product
// WITHOUT the status / amount / sourceType guards that session-ledger's
// classifyOrder enforces. Two real over-credit paths: (1) a sourceType=calendar
// placeholder order (GHL auto-creates one per booking) re-credits a session
// under a different orderId; (2) a $0 fully-couponed order still credits the
// full pack. isCreditableOrder mirrors classifyOrder's guards.
describe('isCreditableOrder (H3 — gate the Orders-API fallback)', () => {
  const ok = { status: 'completed', amount: 720, sourceType: 'point_of_sale' };

  it('TRUE for a completed, paid, non-calendar order', () => {
    expect(isCreditableOrder(ok)).toBe(true);
    expect(isCreditableOrder({ ...ok, sourceType: 'payment_link' })).toBe(true);
  });

  it('FALSE for a non-completed order (pending/refunded/etc.)', () => {
    expect(isCreditableOrder({ ...ok, status: 'pending' })).toBe(false);
    expect(isCreditableOrder({ ...ok, status: 'refunded' })).toBe(false);
    expect(isCreditableOrder({ ...ok, status: '' })).toBe(false);
  });

  it('FALSE for a $0 order (the fully-couponed-referral path)', () => {
    expect(isCreditableOrder({ ...ok, amount: 0 })).toBe(false);
    expect(isCreditableOrder({ ...ok, amount: undefined })).toBe(false);
  });

  it('FALSE for a calendar-source placeholder order (the double-credit path)', () => {
    expect(isCreditableOrder({ ...ok, sourceType: 'calendar' })).toBe(false);
    // sourceType can also arrive nested as source.type
    expect(isCreditableOrder({ status: 'completed', amount: 190, source: { type: 'calendar' } })).toBe(false);
  });

  it('is case-insensitive on status and sourceType', () => {
    expect(isCreditableOrder({ status: 'COMPLETED', amount: 720, sourceType: 'POINT_OF_SALE' })).toBe(true);
    expect(isCreditableOrder({ status: 'Completed', amount: 190, sourceType: 'Calendar' })).toBe(false);
  });
});

// ── D1 idempotency (duplicate-event dedup) ──
// These tests use an in-memory mock of the D1 binding to verify that two
// concurrent requests for the same event ID cannot both proceed. The real D1
// INSERT ON CONFLICT is atomic at the database level — the mock proves the
// caller-side logic interprets changes=0 correctly.

function makeD1Mock() {
  const rows = new Map();
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _args: [],
        bind(...args) { this._args = args; return this; },
        async run() {
          const eventId = this._args[0];
          if (rows.has(eventId)) {
            return { meta: { changes: 0 } };
          }
          rows.set(eventId, this._args[1]);
          return { meta: { changes: 1 } };
        },
      };
    },
    _rows: rows,
  };
}

describe('claimProcessedEvent (D1 duplicate-event dedup)', () => {
  it('returns null when db is not provided (KV fallback path)', async () => {
    expect(await claimProcessedEvent(null, 'order:abc')).toBe(null);
    expect(await claimProcessedEvent(undefined, 'order:abc')).toBe(null);
  });

  it('returns null when eventId is missing (no key to claim)', async () => {
    const db = makeD1Mock();
    expect(await claimProcessedEvent(db, null)).toBe(null);
    expect(await claimProcessedEvent(db, '')).toBe(null);
  });

  it('returns { ok: true } on first call for a new event', async () => {
    const db = makeD1Mock();
    const result = await claimProcessedEvent(db, 'order:ord-001');
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: false, duplicate: true } on a second call for the same event', async () => {
    const db = makeD1Mock();
    const first = await claimProcessedEvent(db, 'order:ord-002');
    expect(first).toEqual({ ok: true });
    const second = await claimProcessedEvent(db, 'order:ord-002');
    expect(second).toEqual({ ok: false, duplicate: true });
  });

  it('distinct event IDs are independent — each wins its own claim', async () => {
    const db = makeD1Mock();
    expect(await claimProcessedEvent(db, 'order:ord-A')).toEqual({ ok: true });
    expect(await claimProcessedEvent(db, 'order:ord-B')).toEqual({ ok: true });
    expect(await claimProcessedEvent(db, 'order:ord-A')).toEqual({ ok: false, duplicate: true });
    expect(await claimProcessedEvent(db, 'order:ord-B')).toEqual({ ok: false, duplicate: true });
  });

  it('simulates concurrent race: both calls read before either writes — only the INSERT winner proceeds', async () => {
    // Simulate two concurrent requests: both observe changes=1 is impossible
    // because the DB serialises INSERT ON CONFLICT. The mock serialises too.
    const db = makeD1Mock();
    const [r1, r2] = await Promise.all([
      claimProcessedEvent(db, 'order:ord-race'),
      claimProcessedEvent(db, 'order:ord-race'),
    ]);
    const winners = [r1, r2].filter((r) => r?.ok === true);
    const losers  = [r1, r2].filter((r) => r?.ok === false && r?.duplicate === true);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
  });
});
