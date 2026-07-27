import { describe, it, expect } from 'vitest';
import {
  classifyInvoiceProduct,
  selectSeriesInvoice,
  INVOICE_PURCHASE_PRODUCTS,
  KV_TTL_SECONDS,
} from './ghl-invoice-webhook.js';
import { claimProcessedEvent } from '../lib/processed-events.js';

// Real productIds kept in sync with ACTIVE_PRODUCTS in session-ledger.js
const PID = {
  eightSeries: '69987357c839790426996114',
  fourSeries: '69986faa724ecd2343ebaa6e',
  twelveWeek: '6a66cde7ef7b07f122ad46fb',
  eightUpgrade: '699873d6990b71ebc1fa26b4',
  fourUpgrade: '6998739230cc6054f9bba62d',
  followupInPerson: '69aee204e80b62d627d8e922',
  initialInPerson: '688a1cd770362828afbf08a2',
  entrainment: '69c5d29c4019ce8e80e2513b',
  livingPractice: '6998d7f2606fa79c54fa3ff5',
  retiredFollowup: '67f57171b6b1019c7b0233cc',
};

function invoice({
  id = 'inv-1',
  productId = null,
  itemName = 'Item',
  status = 'paid',
  amountPaid = 1295,
  issueDate = '2026-03-18T18:44:00Z',
}) {
  return {
    _id: id,
    status,
    amountPaid,
    total: amountPaid,
    issueDate,
    invoiceItems: [{ name: itemName, productId, amount: amountPaid, qty: 1 }],
  };
}

describe('classifyInvoiceProduct', () => {
  it('classifies 8-Session Series', () => {
    expect(classifyInvoiceProduct(PID.eightSeries)).toMatchObject({
      name: '8-Session Series',
      sessionsRemaining: 8,
      seriesType: '8-session',
      livingPractice: true,
    });
  });

  it('classifies 4-Session Series', () => {
    expect(classifyInvoiceProduct(PID.fourSeries)).toMatchObject({
      name: '4-Session Series',
      sessionsRemaining: 4,
      seriesType: '4-session',
      livingPractice: false,
    });
  });
  it('classifies the 12-Week Amari Practice', () => {
    expect(classifyInvoiceProduct(PID.twelveWeek)).toMatchObject({
      name: 'The 12-Week Amari Practice',
      sessionsRemaining: 24,
      seriesType: '12-week',
      livingPractice: true,
    });
  });

  it('classifies Upgrade → 8', () => {
    expect(classifyInvoiceProduct(PID.eightUpgrade)).toMatchObject({
      sessionsRemaining: 7,
      seriesType: '8-session',
      livingPractice: true,
    });
  });

  it('classifies Upgrade → 4', () => {
    expect(classifyInvoiceProduct(PID.fourUpgrade)).toMatchObject({
      sessionsRemaining: 3,
      seriesType: '4-session',
      livingPractice: false,
    });
  });

  it('returns null for non-series active products (follow-up, initial, entrainment, living practice)', () => {
    expect(classifyInvoiceProduct(PID.followupInPerson)).toBe(null);
    expect(classifyInvoiceProduct(PID.initialInPerson)).toBe(null);
    expect(classifyInvoiceProduct(PID.entrainment)).toBe(null);
    expect(classifyInvoiceProduct(PID.livingPractice)).toBe(null);
  });

  it('returns null for retired productIds', () => {
    expect(classifyInvoiceProduct(PID.retiredFollowup)).toBe(null);
  });

  it('returns null for null / undefined / empty', () => {
    expect(classifyInvoiceProduct(null)).toBe(null);
    expect(classifyInvoiceProduct(undefined)).toBe(null);
    expect(classifyInvoiceProduct('')).toBe(null);
  });
});

describe('INVOICE_PURCHASE_PRODUCTS map', () => {
  it('has exactly 6 entries (3 practices + 3 upgrades)', () => {
    // 4→8 upgrade ($575) added to ghl-products.js 2026-05-10; this assertion was
    // never bumped from 4 and sat red unnoticed (no CI gate — audit HIGH #7).
    expect(Object.keys(INVOICE_PURCHASE_PRODUCTS).length).toBe(6);
  });

  it('does NOT include single-session products, entrainment, or living practice', () => {
    expect(INVOICE_PURCHASE_PRODUCTS[PID.followupInPerson]).toBeUndefined();
    expect(INVOICE_PURCHASE_PRODUCTS[PID.initialInPerson]).toBeUndefined();
    expect(INVOICE_PURCHASE_PRODUCTS[PID.entrainment]).toBeUndefined();
    expect(INVOICE_PURCHASE_PRODUCTS[PID.livingPractice]).toBeUndefined();
  });
});

describe('KV idempotency TTL (H2 — must cover the replay window)', () => {
  // The idempotency record must outlive the window in which a re-delivery or a
  // later non-package invoice could re-trigger crediting. 30d was the short
  // outlier (reconcile uses 90d); a package whose record expired at 30d got
  // re-applied. Match 90d.
  it('is at least 90 days', () => {
    expect(KV_TTL_SECONDS).toBeGreaterThanOrEqual(90 * 86400);
  });
});

describe('selectSeriesInvoice', () => {
  it('returns null on empty list', () => {
    expect(selectSeriesInvoice([])).toBe(null);
    expect(selectSeriesInvoice(null)).toBe(null);
    expect(selectSeriesInvoice(undefined)).toBe(null);
  });

  it('picks the most recent paid series invoice when id not provided', () => {
    const result = selectSeriesInvoice([
      invoice({ id: 'old', productId: PID.fourSeries, issueDate: '2026-01-01T00:00:00Z' }),
      invoice({ id: 'new', productId: PID.eightSeries, issueDate: '2026-03-18T18:44:00Z' }),
    ]);
    expect(result).not.toBe(null);
    expect(result.invoice._id).toBe('new');
    expect(result.pkg.name).toBe('8-Session Series');
  });

  it('honors preferredInvoiceId when provided (matches _id)', () => {
    const result = selectSeriesInvoice(
      [
        invoice({ id: 'old', productId: PID.fourSeries, issueDate: '2026-01-01T00:00:00Z' }),
        invoice({ id: 'new', productId: PID.eightSeries, issueDate: '2026-03-18T18:44:00Z' }),
      ],
      'old',
    );
    expect(result.invoice._id).toBe('old');
    expect(result.pkg.name).toBe('4-Session Series');
  });

  // H2 (2026-06-11 review): when the triggering invoice matched preferredInvoiceId
  // but ISN'T a package, the code fell through to the "scan all paid, most recent
  // first" block and re-matched an OLD package invoice — and because the old
  // package's KV idempotency record had expired (30d TTL), it RE-APPLIED, resetting
  // sessions_remaining to full. The webhook is about THIS invoice; a non-package
  // invoice must credit nothing.
  it('returns null when the preferred invoice matches but is NOT a package — no fall-through to an old package (H2)', () => {
    // Client bought an 8-pack in January; in March pays a $90 Entrainment invoice.
    // The webhook fires for the Entrainment invoice — it must NOT re-credit the 8-pack.
    const result = selectSeriesInvoice(
      [
        invoice({ id: 'jan-8pack', productId: PID.eightSeries, issueDate: '2026-01-01T00:00:00Z' }),
        invoice({ id: 'mar-entrainment', productId: PID.entrainment, amountPaid: 90, issueDate: '2026-03-01T00:00:00Z' }),
      ],
      'mar-entrainment',
    );
    expect(result).toBe(null);
  });

  // Still falls through to history when the preferred id can't be found at all
  // (id-format mismatch / pagination) — that resilience is intentional and must
  // not regress.
  it('falls through to the most recent paid package when preferredInvoiceId is not found', () => {
    const result = selectSeriesInvoice(
      [invoice({ id: 'real-8pack', productId: PID.eightSeries })],
      'some-unknown-id',
    );
    expect(result?.pkg.name).toBe('8-Session Series');
  });

  it('matches preferredInvoiceId against invoiceNumber (GHL merge tag format)', () => {
    // GHL's {{invoice.number}} merge tag exposes "INV-000030" style numbers,
    // not the database _id hex. selectSeriesInvoice must match both.
    const invoices = [
      {
        ...invoice({ id: '69bb54a95aa10f5d7a21f0ca', productId: PID.eightSeries }),
        invoiceNumber: 'INV-000030',
      },
      {
        ...invoice({ id: '698563701ab09d641ba7ec71', productId: PID.fourSeries }),
        invoiceNumber: 'INV-000028',
      },
    ];
    const result = selectSeriesInvoice(invoices, 'INV-000028');
    expect(result.invoice._id).toBe('698563701ab09d641ba7ec71');
    expect(result.pkg.name).toBe('4-Session Series');
  });

  it('skips non-series invoices (follow-ups, retired, entrainment)', () => {
    const result = selectSeriesInvoice([
      invoice({ id: '1', productId: PID.followupInPerson }),
      invoice({ id: '2', productId: PID.retiredFollowup }),
      invoice({ id: '3', productId: PID.entrainment }),
    ]);
    expect(result).toBe(null);
  });

  it('skips draft/void/sent invoices', () => {
    const result = selectSeriesInvoice([
      invoice({ id: '1', productId: PID.eightSeries, status: 'draft', amountPaid: 0 }),
      invoice({ id: '2', productId: PID.eightSeries, status: 'void' }),
      invoice({ id: '3', productId: PID.eightSeries, status: 'sent', amountPaid: 0 }),
    ]);
    expect(result).toBe(null);
  });

  it('skips invoices with amountPaid = 0 even if status is paid', () => {
    const result = selectSeriesInvoice([
      invoice({ id: '1', productId: PID.eightSeries, status: 'paid', amountPaid: 0 }),
    ]);
    expect(result).toBe(null);
  });

  it("falls back to scanning when preferredInvoiceId doesn't match anything", () => {
    const result = selectSeriesInvoice(
      [
        invoice({ id: 'existing', productId: PID.fourSeries }),
      ],
      'nonexistent-id',
    );
    expect(result).not.toBe(null);
    expect(result.invoice._id).toBe('existing');
  });

  it("Danny's case: 14 invoices, only 1 is a series → picks the series one", () => {
    const invoices = [
      // 12 retired $200 follow-ups
      ...Array.from({ length: 12 }, (_, i) =>
        invoice({
          id: `retired-${i}`,
          productId: PID.retiredFollowup,
          amountPaid: 200,
          issueDate: `2025-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00Z`,
        }),
      ),
      // 1 retired "Balanced for Life"
      invoice({
        id: 'bfl',
        productId: '67b1201e37cdce1f5b09b8ba',
        amountPaid: 475,
        issueDate: '2025-05-31T00:00:00Z',
      }),
      // The real 8-pack
      invoice({
        id: 'inv-000030',
        productId: PID.eightSeries,
        amountPaid: 1295,
        issueDate: '2026-03-18T18:44:00Z',
      }),
    ];
    const result = selectSeriesInvoice(invoices);
    expect(result).not.toBe(null);
    expect(result.invoice._id).toBe('inv-000030');
    expect(result.pkg.name).toBe('8-Session Series');
    expect(result.pkg.sessionsRemaining).toBe(8);
  });
});

// ── D1 idempotency (duplicate-event dedup) ──
// Mirrors the same tests in ghl-purchase-webhook.test.js to confirm both
// handlers share the same dedup contract via processed-events.js.

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
          if (rows.has(eventId)) return { meta: { changes: 0 } };
          rows.set(eventId, this._args[1]);
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

describe('claimProcessedEvent (D1 duplicate-event dedup — invoice webhook)', () => {
  it('returns null when db is not provided', async () => {
    expect(await claimProcessedEvent(null, 'invoice:inv-1')).toBe(null);
  });

  it('returns null when eventId is missing', async () => {
    expect(await claimProcessedEvent(makeD1Mock(), null)).toBe(null);
    expect(await claimProcessedEvent(makeD1Mock(), '')).toBe(null);
  });

  it('returns { ok: true } on first call, { ok: false, duplicate: true } on second', async () => {
    const db = makeD1Mock();
    expect(await claimProcessedEvent(db, 'invoice:inv-abc')).toEqual({ ok: true });
    expect(await claimProcessedEvent(db, 'invoice:inv-abc')).toEqual({ ok: false, duplicate: true });
  });

  it('concurrent race — exactly one winner per invoice ID', async () => {
    const db = makeD1Mock();
    const [r1, r2] = await Promise.all([
      claimProcessedEvent(db, 'invoice:inv-race'),
      claimProcessedEvent(db, 'invoice:inv-race'),
    ]);
    const winners = [r1, r2].filter((r) => r?.ok === true);
    const losers  = [r1, r2].filter((r) => r?.ok === false && r?.duplicate === true);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
  });
});
