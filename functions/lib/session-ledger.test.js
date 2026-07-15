import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ghlFetch so computeSessionLedger tests can route requests by URL
// without hitting the network. Pure-function tests (deriveLedger,
// classifyOrder, classifyInvoice) don't touch ghlFetch so the mock is inert
// for them.
const ghlResponses = new Map();
vi.mock('./ghl.js', () => ({
  ghlFetch: vi.fn(async (_ctx, url) => {
    for (const [pattern, response] of ghlResponses.entries()) {
      if (url.includes(pattern)) return response;
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }),
}));

import {
  deriveLedger,
  classifyOrder,
  classifyInvoice,
  computeSessionLedger,
  SERIES_CALENDAR_IDS,
  ACTIVE_PRODUCTS,
  determineSeriesType,
} from './session-ledger.js';

describe('determineSeriesType', () => {
  it('a 4-pack + 4→8 upgrade resolves to 8-session (not 4-session)', () => {
    // Regression: the consolidation surfaced the "4-to-8-upgrade" type but this
    // function only checked 8-series/8-upgrade, so 4→8 upgraders showed the
    // wrong plan tier in the portal. (session-tracking re-audit 2026-06-06)
    expect(determineSeriesType([{ type: '4-series' }, { type: '4-to-8-upgrade' }])).toBe('8-session');
    expect(determineSeriesType([{ type: '4-to-8-upgrade' }])).toBe('8-session');
  });
  it('plain 4-series stays 4-session', () => {
    expect(determineSeriesType([{ type: '4-series' }])).toBe('4-session');
  });
  it('8-series and 8-upgrade are 8-session', () => {
    expect(determineSeriesType([{ type: '8-series' }])).toBe('8-session');
    expect(determineSeriesType([{ type: '8-upgrade' }])).toBe('8-session');
  });
});

// ── Fixture helpers ─────────────────────────────────────────────────────────

function order({ sourceName, amount, status = 'completed', sourceType = 'payment_link', createdAt = '2026-03-13T00:00:00Z' }) {
  return { sourceName, amount, status, sourceType, createdAt };
}

function invoice({ productId = null, itemName = 'Item', amountPaid, status = 'paid', issueDate = '2026-03-13T00:00:00Z', total = null }) {
  return {
    name: 'New Invoice',
    status,
    amountPaid,
    total: total ?? amountPaid,
    issueDate,
    invoiceItems: [{ name: itemName, productId, amount: amountPaid, qty: 1 }],
  };
}

function appt({ calendarId, status = 'showed', startTime = '2026-03-15T18:00:00Z' }) {
  return { calendarId, appointmentStatus: status, startTime };
}

function contact({ customFields = [] } = {}) {
  return { id: 'contact-1', customFields };
}

// Real productIds from ACTIVE_PRODUCTS (kept in sync with session-ledger.js).
const PID = {
  eightSeries: '69987357c839790426996114',
  fourSeries: '69986faa724ecd2343ebaa6e',
  eightUpgrade: '699873d6990b71ebc1fa26b4',
  fourUpgrade: '6998739230cc6054f9bba62d',
  initialInPerson: '688a1cd770362828afbf08a2',
  initialVirtual: '690b6b4d333ffa59d40c1823',
  followupInPerson: '69aee204e80b62d627d8e922',
  followupVirtual: '69aee3ebcf9cf8ed9f6c928d',
  singleFollowup: '6998ace59dfde469ecb2aab6',
  prePurchased: '67b1299f080422451447bdd0',
  entrainment: '69c5d29c4019ce8e80e2513b',
  livingPractice: '6998d7f2606fa79c54fa3ff5',
  // Retired (not in ACTIVE_PRODUCTS)
  retiredFollowup: '67f57171b6b1019c7b0233cc',
  retiredFollowupCalendars: '690b6b4d7ca9fb527702f2ec',
  retiredBalanceForLife: '67b1201e37cdce1f5b09b8ba',
};

const FIELD_DEFS = {
  sessions_remaining: 'wrQSkx6BhXwDGIn1d0V4',
  sessions_completed: 'TE0udwVH1Km5RsKaN5H0',
  series_type: '3i93lTkmuAV49s9nh0q8',
  session_prepaid: 'sgQ5EbJWhvTfGVhStaOO',
};

const CAL = {
  initial: 'G7OAnnJuFbMF6nQSlZVQ',
  initialVirtual: 'ySmht5hx4uZGEpgZrlCw',
  initialPaidAtPartner: 'uUDFD0ZQEWtzGLS9aLq7',
  followup: 'SKDVOL8wtUN6Ne0ppbC9',
  followupPackage: 'ZO1jlGfy01rsxVqicoSB',
  followupVirtual: 'oVn77FcecFY16iS2pHyP',
  entrainment: 'B5aGXLoS4kzAjZAMMXxk',
  discovery: 'USgPsktqRcuomdUgpShL',
  partner: 'lfsnaiGiLNL2z12pLKDP',
};

// ── classifyOrder ───────────────────────────────────────────────────────────

describe('classifyOrder', () => {
  it('classifies 4-session series', () => {
    expect(classifyOrder(order({ sourceName: '4-Session Series', amount: 720 })))
      .toMatchObject({ type: '4-series', sessions: 4 });
  });

  it('classifies 8-session series', () => {
    expect(classifyOrder(order({ sourceName: '8-Session Series', amount: 1295 })))
      .toMatchObject({ type: '8-series', sessions: 8 });
  });

  it('classifies upgrade to 4-session by amount', () => {
    expect(classifyOrder(order({ sourceName: 'Upgrade Series', amount: 495 })))
      .toMatchObject({ type: '4-upgrade', sessions: 3 });
  });

  it('classifies upgrade to 8-session by amount', () => {
    expect(classifyOrder(order({ sourceName: 'Upgrade Series', amount: 1070 })))
      .toMatchObject({ type: '8-upgrade', sessions: 7 });
  });

  it('classifies individual initial session', () => {
    expect(classifyOrder(order({ sourceName: 'Initial Session', amount: 225 })))
      .toMatchObject({ type: 'initial', sessions: 1 });
  });

  it('classifies individual follow-up session', () => {
    expect(classifyOrder(order({ sourceName: 'Follow-up Session', amount: 190 })))
      .toMatchObject({ type: 'followup', sessions: 1 });
  });

  it('classifies entrainment as 0 sessions (not against series)', () => {
    expect(classifyOrder(order({ sourceName: 'Entrainment', amount: 90 })))
      .toMatchObject({ type: 'entrainment', sessions: 0 });
  });

  it('ignores incomplete orders', () => {
    expect(classifyOrder(order({ sourceName: '4-Session Series', amount: 720, status: 'pending' })))
      .toMatchObject({ type: 'ignored', sessions: 0 });
  });

  it('ignores zero-amount orders', () => {
    expect(classifyOrder(order({ sourceName: '4-Session Series', amount: 0 })))
      .toMatchObject({ type: 'ignored', sessions: 0 });
  });

  it('treats booking-generated placeholder orders as 0 sessions', () => {
    // GHL auto-creates a "completed" order on every calendar booking with
    // Accept Payments enabled. These have sourceType="calendar" and look
    // identical to real follow-up purchases except for sourceType.
    expect(
      classifyOrder(
        order({ sourceName: 'Follow-up Session — In Person', amount: 190, sourceType: 'calendar' }),
      ),
    ).toMatchObject({ type: 'placeholder', sessions: 0 });
  });

  it('placeholder rule catches entrainment calendar bookings too', () => {
    // Entrainments are already 0 via the entrainment branch, but should also
    // hit the placeholder branch first when sourceType=calendar.
    expect(
      classifyOrder(order({ sourceName: 'Entrainment', amount: 90, sourceType: 'calendar' })),
    ).toMatchObject({ type: 'placeholder', sessions: 0 });
  });

  it('still counts real payment_link purchases', () => {
    expect(
      classifyOrder(
        order({ sourceName: '4 Session Series Link', amount: 720, sourceType: 'payment_link' }),
      ),
    ).toMatchObject({ type: '4-series', sessions: 4 });
  });

  it('classifies POS / mobile_app orders by items[0].product._id', () => {
    // POS orders carry productId via the detail endpoint's items array.
    // sourceName is empty for these; productId is the only signal.
    // Regression test for 2026-06-03 Jenn Kadri incident.
    const posOrder = {
      sourceName: '',
      sourceType: 'point_of_sale',
      status: 'completed',
      amount: 1295,
      items: [{ product: { _id: PID.eightSeries, name: '8-Session Series' } }],
    };
    expect(classifyOrder(posOrder)).toMatchObject({ type: '8-series', sessions: 8 });
  });

  it('POS order WITHOUT hydrated items falls through to "other"', () => {
    // Documents the failure mode that motivated the order-detail hydration
    // step in computeSessionLedger. If a caller passes a summary-only order
    // (LIST endpoint shape), classification cannot succeed — caller must
    // hydrate via /payments/orders/{id} first.
    const summaryOnly = {
      sourceName: '',
      sourceType: 'point_of_sale',
      status: 'completed',
      amount: 1295,
      // No items array — this is what the LIST endpoint returns.
    };
    expect(classifyOrder(summaryOnly)).toMatchObject({ type: 'other', sessions: 0 });
  });

  it('flags hydration failure on the classification', () => {
    // When hydrateOrders can't fetch detail (404, 5xx, network), it stamps
    // __hydration_failed on the order. classifyOrder propagates this flag
    // so deriveLedger can push an ambiguity → confidence drops → worker
    // skips the write. Without this, a transient GHL failure would let
    // the worker silently zero a correct sessions_remaining field.
    const failedHydration = {
      sourceName: '',
      sourceType: 'point_of_sale',
      status: 'completed',
      amount: 1295,
      __hydration_failed: true,
      __hydration_reason: 'GHL detail status 429',
    };
    const result = classifyOrder(failedHydration);
    expect(result.type).toBe('other');
    expect(result.hydrationFailed).toBe(true);
    expect(result.hydrationReason).toBe('GHL detail status 429');
  });
});

// ── classifyInvoice ─────────────────────────────────────────────────────────

describe('classifyInvoice', () => {
  it('classifies 8-Session Series by productId', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.eightSeries, itemName: '8-Session Series', amountPaid: 1295 })),
    ).toMatchObject({ type: '8-series', sessions: 8 });
  });

  it('classifies 4-Session Series by productId', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.fourSeries, itemName: '4-Session Series', amountPaid: 720 })),
    ).toMatchObject({ type: '4-series', sessions: 4 });
  });

  it('classifies 4-upgrade and 8-upgrade by productId', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.fourUpgrade, amountPaid: 495 })),
    ).toMatchObject({ type: '4-upgrade', sessions: 3 });
    expect(
      classifyInvoice(invoice({ productId: PID.eightUpgrade, amountPaid: 1070 })),
    ).toMatchObject({ type: '8-upgrade', sessions: 7 });
  });

  it('classifies follow-ups (in person, virtual, single, pre-purchased) as 1 session', () => {
    for (const pid of [PID.followupInPerson, PID.followupVirtual, PID.singleFollowup, PID.prePurchased]) {
      expect(classifyInvoice(invoice({ productId: pid, amountPaid: 190 }))).toMatchObject({
        sessions: 1,
      });
    }
  });

  it('classifies initial sessions (in person + virtual) as 1 session each', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.initialInPerson, amountPaid: 225 })),
    ).toMatchObject({ type: 'initial', sessions: 1 });
    expect(
      classifyInvoice(invoice({ productId: PID.initialVirtual, amountPaid: 225 })),
    ).toMatchObject({ type: 'initial', sessions: 1 });
  });

  it('classifies entrainment and living practice as 0 sessions', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.entrainment, amountPaid: 90 })),
    ).toMatchObject({ type: 'entrainment', sessions: 0 });
    expect(
      classifyInvoice(invoice({ productId: PID.livingPractice, amountPaid: 347 })),
    ).toMatchObject({ type: 'living-practice', sessions: 0 });
  });

  it('classifies retired productIds as retired (0 sessions)', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.retiredFollowup, amountPaid: 200 })),
    ).toMatchObject({ type: 'retired', sessions: 0 });
    expect(
      classifyInvoice(invoice({ productId: PID.retiredBalanceForLife, amountPaid: 475 })),
    ).toMatchObject({ type: 'retired', sessions: 0 });
  });

  it('classifies custom items with null productId as retired (0 sessions)', () => {
    expect(
      classifyInvoice(invoice({ productId: null, itemName: 'Custom Item', amountPaid: 200 })),
    ).toMatchObject({ type: 'retired', sessions: 0 });
  });

  it('ignores draft invoices (status != paid)', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.eightSeries, amountPaid: 0, status: 'draft' })),
    ).toMatchObject({ type: 'ignored', sessions: 0 });
  });

  it('ignores invoices with amountPaid = 0 even if status=paid', () => {
    expect(
      classifyInvoice(invoice({ productId: PID.eightSeries, amountPaid: 0 })),
    ).toMatchObject({ type: 'ignored', sessions: 0 });
  });

  it('preserves issueDate on the classification', () => {
    const result = classifyInvoice(
      invoice({
        productId: PID.eightSeries,
        amountPaid: 1295,
        issueDate: '2026-03-18T18:44:00Z',
      }),
    );
    expect(result.date).toBe('2026-03-18T18:44:00Z');
  });
});

// ── ACTIVE_PRODUCTS sanity ──────────────────────────────────────────────────

describe('ACTIVE_PRODUCTS map', () => {
  it('contains the 13 currently-sold products', () => {
    expect(Object.keys(ACTIVE_PRODUCTS).length).toBe(13);
  });

  it('contains the canonical 8-Session and 4-Session Series IDs', () => {
    expect(ACTIVE_PRODUCTS[PID.eightSeries]).toEqual({ type: '8-series', sessions: 8 });
    expect(ACTIVE_PRODUCTS[PID.fourSeries]).toEqual({ type: '4-series', sessions: 4 });
  });
});

// ── deriveLedger ────────────────────────────────────────────────────────────

describe('deriveLedger — clean cases', () => {
  it('clean 4-session client with 2 attended → remaining 2', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [
        appt({ calendarId: CAL.initial }),
        appt({ calendarId: CAL.followup }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(2);
    expect(result.remaining).toBe(2);
    expect(result.seriesType).toBe('4-session');
    expect(result.confidence).toBe('high');
  });

  it('clean 8-session client with no attendance → remaining 8', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '8-Session Series', amount: 1295 })],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(0);
    expect(result.remaining).toBe(8);
    expect(result.seriesType).toBe('8-session');
  });

  it('upgrade path: initial + upgrade order = 4 purchased', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({ sourceName: 'Initial Session', amount: 225 }),
        order({ sourceName: 'Upgrade to 4-Session', amount: 495 }),
      ],
      appointments: [appt({ calendarId: CAL.initial })],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(3);
    expect(result.seriesType).toBe('4-session');
  });

  it('multi-series: two 4-session purchases = 8 purchased', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({ sourceName: '4-Session Series', amount: 720 }),
        order({ sourceName: '4-Session Series', amount: 720 }),
      ],
      appointments: Array(5).fill(null).map(() => appt({ calendarId: CAL.followup })),
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(5);
    expect(result.remaining).toBe(3);
  });
});

describe('deriveLedger — booking-generated placeholder exclusion', () => {
  it("Betsy's case: 4-series + 3 booking placeholders → purchased stays at 4", () => {
    // Reproduces the real-world diagnosis of Betsy Kemp 2026-04-10.
    // She has one real $720 4-session purchase (payment_link) and three
    // booking-generated $190 follow-up placeholders (sourceType: "calendar")
    // from booking her prepaid follow-ups. Pre-fix this showed purchased=7.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({ sourceName: '4 Session Series Link', amount: 720, sourceType: 'payment_link' }),
        order({ sourceName: 'Follow-up Session — In Person', amount: 190, sourceType: 'calendar' }),
        order({ sourceName: 'Follow-up Session — In Person', amount: 190, sourceType: 'calendar' }),
        order({ sourceName: 'Follow-up Session — In Person', amount: 190, sourceType: 'calendar' }),
        order({ sourceName: 'Entrainment', amount: 90, sourceType: 'calendar' }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial }),
        appt({ calendarId: CAL.followup }),
        appt({ calendarId: CAL.followup }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(3);
    expect(result.remaining).toBe(1);
    expect(result.seriesType).toBe('4-session');
  });

  it('client with only placeholder orders → seriesType "none", no purchases counted', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({ sourceName: 'Follow-up Session — In Person', amount: 190, sourceType: 'calendar' }),
        order({ sourceName: 'Follow-up Session — In Person', amount: 190, sourceType: 'calendar' }),
      ],
      appointments: [appt({ calendarId: CAL.followup })],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(0);
    expect(result.seriesType).toBe('none');
    expect(result.remaining).toBe(0);
  });
});

describe('deriveLedger — Kristina 8-Session Series regression (2026-07-08)', () => {
  it('Kristina 8-Session Series: $1,295 order → remaining 8, series 8-session', () => {
    // Kristina Schubert paid a real $1,295 8-Session Series (payment_link,
    // completed). A second $190 sourceType="calendar" placeholder order (a
    // booking artifact, no card charged) must be ignored. She has a 7/6
    // Partner Initial comp on a NON-series calendar (showed, does NOT draw
    // the pack) and an upcoming 7/13 follow-up (confirmed, future). Correct
    // verdict: pack full, no paid session consumed → remaining 8, 8-session.
    // The bug that must never regress: her balance derived as 0 (or her order
    // failing to classify).
    const kristinaOrders = [
      {
        sourceName: '',
        sourceType: 'payment_link',
        status: 'completed',
        amount: 1295,
        createdAt: '2026-07-05T18:00:00Z',
        // classifyOrder reads items[0].product._id and looks it up by EXACT
        // productId — the real order carries the 8-Session Series productId.
        items: [{ product: { _id: PID.eightSeries, name: '8-Session Series' } }],
      },
      // $190 booking placeholder — sourceType=calendar → classifies as
      // "placeholder", 0 sessions, must not inflate purchased.
      {
        sourceName: 'Follow-up Session — In Person',
        sourceType: 'calendar',
        status: 'completed',
        amount: 190,
        createdAt: '2026-07-06T20:00:00Z',
        items: [{ product: { _id: PID.followupInPerson } }],
      },
    ];
    const kristinaAppts = [
      // 7/6 Partner Initial comp — NON-series calendar, showed. Does not draw.
      appt({ calendarId: CAL.partner, status: 'showed', startTime: '2026-07-06T18:00:00Z' }),
      // 7/13 follow-up — series calendar but confirmed + future, not attended.
      appt({ calendarId: CAL.followup, status: 'confirmed', startTime: '2026-07-13T18:00:00Z' }),
    ];

    const result = deriveLedger({
      contact: contact(),
      orders: kristinaOrders,
      appointments: kristinaAppts,
      fieldDefs: FIELD_DEFS,
    });

    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(0);
    expect(result.remaining).toBe(8);
    expect(result.seriesType).toBe('8-session');
    expect(result.display.seriesType).toBe('8-session');
    expect(result.display.remaining).toBe(8);
    expect(result.confidence).toBe('high');
  });
});

describe('deriveLedger — entrainment exclusion', () => {
  it('8-session with 3 follow-ups + 2 entrainments → remaining 5 (entrainments excluded)', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '8-Session Series', amount: 1295 })],
      appointments: [
        appt({ calendarId: CAL.followup }),
        appt({ calendarId: CAL.followup }),
        appt({ calendarId: CAL.followup }),
        appt({ calendarId: CAL.entrainment }),
        appt({ calendarId: CAL.entrainment }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(3);
    expect(result.remaining).toBe(5);
  });

  it('discovery calls, partner sessions, and "paid at partner" excluded from attended', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [
        appt({ calendarId: CAL.followup }),
        appt({ calendarId: CAL.discovery }),
        appt({ calendarId: CAL.partner }),
        appt({ calendarId: CAL.initialPaidAtPartner }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(3);
  });

  it('only counts attended/showed, ignores cancelled and no-shows', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [
        appt({ calendarId: CAL.followup, status: 'showed' }),
        appt({ calendarId: CAL.followup, status: 'noshow' }),
        appt({ calendarId: CAL.followup, status: 'cancelled' }),
        appt({ calendarId: CAL.followup, status: 'confirmed' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.attended).toBe(1);
  });
});

describe('deriveLedger — overrides and edge cases', () => {
  it('manual prepaid override with no orders → prepaidOverride true', () => {
    const result = deriveLedger({
      contact: contact({
        customFields: [{ id: FIELD_DEFS.session_prepaid, value: 'yes' }],
      }),
      orders: [],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.prepaidOverride).toBe(true);
    expect(result.purchased).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('no orders no appointments → empty ledger, high confidence', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(0);
    expect(result.attended).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.seriesType).toBe('none');
    expect(result.confidence).toBe('high');
  });

  it('attended > purchased → remaining floored at 0, ambiguity flagged', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: Array(6).fill(null).map(() => appt({ calendarId: CAL.followup })),
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(6);
    expect(result.remaining).toBe(0);
    expect(result.confidence).toBe('low');
    expect(result.ambiguities.some((a) => a.includes('attended exceeds'))).toBe(true);
  });

  it('flags discrepancy when custom field disagrees with derived remaining', () => {
    const result = deriveLedger({
      contact: contact({
        customFields: [{ id: FIELD_DEFS.sessions_remaining, value: '1' }],
      }),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [
        appt({ calendarId: CAL.followup }),
        appt({ calendarId: CAL.followup }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.remaining).toBe(2);
    expect(result.confidence).toBe('low');
    expect(result.ambiguities.some((a) => a.includes('custom field'))).toBe(true);
  });

  // The series-reconcile worker passes deriveLedger ONLY session_prepaid (its
  // LEDGER_FIELD_DEFS) — never sessions_remaining/series_type. These two tests lock in
  // that this "threads the needle": the prepaid guard fires (so the worker won't zero a
  // real prepaid balance) while the field-disagreement ambiguity does NOT (so the worker
  // still corrects the very drifts it exists for). Same fixtures as the two tests above,
  // only the fieldDefs differ.
  const PREPAID_ONLY_DEFS = { session_prepaid: FIELD_DEFS.session_prepaid };

  it('prepaid-only fieldDefs: prepaid override + no orders → still LOW confidence (guard alive)', () => {
    const result = deriveLedger({
      contact: contact({ customFields: [{ id: FIELD_DEFS.session_prepaid, value: 'yes' }] }),
      orders: [],
      appointments: [],
      fieldDefs: PREPAID_ONLY_DEFS,
    });
    expect(result.prepaidOverride).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.ambiguities.some((a) => a.toLowerCase().includes('prepaid'))).toBe(true);
  });

  it('prepaid-only fieldDefs: sessions_remaining disagreement is NOT flagged → HIGH confidence (trap avoided)', () => {
    const result = deriveLedger({
      contact: contact({ customFields: [{ id: FIELD_DEFS.sessions_remaining, value: '1' }] }),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [
        appt({ calendarId: CAL.followup }),
        appt({ calendarId: CAL.followup }),
      ],
      fieldDefs: PREPAID_ONLY_DEFS,
    });
    expect(result.remaining).toBe(2);
    expect(result.confidence).toBe('high');
    expect(result.ambiguities).toEqual([]);
  });

  it('lastSessionDate set to most recent attended session', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [
        appt({ calendarId: CAL.followup, startTime: '2026-03-01T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-03-15T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-02-15T18:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.lastSessionDate).toBe('2026-03-15T18:00:00Z');
  });

  it('source is "orders+invoices+appointments" when any purchase source is present', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.source).toBe('orders+invoices+appointments');
  });

  describe('display values', () => {
    const FIELDS = {
      remaining: { id: FIELD_DEFS.sessions_remaining, value: '2' },
      series: { id: FIELD_DEFS.series_type, value: '4-session' },
      locked: { id: 'oDyLqIeq3yTkyhgXhAmk', value: ['true'] },
    };
    const FIELD_DEFS_FULL = { ...FIELD_DEFS, sessions_remaining_locked: 'oDyLqIeq3yTkyhgXhAmk' };

    it('uses derived values when no lock and high confidence', () => {
      const result = deriveLedger({
        contact: contact({ customFields: [] }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [appt({ calendarId: CAL.followup })],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.confidence).toBe('high');
      expect(result.display.remaining).toBe(3);
      expect(result.display.seriesType).toBe('4-session');
      expect(result.display.source).toBe('derived');
    });

    it('falls back to field when manualLock=true (Albert Yang case)', () => {
      const result = deriveLedger({
        contact: contact({ customFields: [FIELDS.remaining, FIELDS.series, FIELDS.locked] }),
        // 4-pack purchased, derivation says attended=1 / remaining=3
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [appt({ calendarId: CAL.followup })],
        fieldDefs: FIELD_DEFS_FULL,
      });
      // derived stays as-is
      expect(result.remaining).toBe(3);
      // display falls back to field
      expect(result.display.remaining).toBe(2);
      expect(result.display.seriesType).toBe('4-session');
      expect(result.display.source).toBe('manual-lock');
    });

    it('falls back to field when confidence=low (no lock)', () => {
      // Ambiguity triggered by attended > purchased — confidence drops.
      const result = deriveLedger({
        contact: contact({ customFields: [FIELDS.remaining, FIELDS.series] }),
        orders: [],
        appointments: [
          appt({ calendarId: CAL.followup }),
          appt({ calendarId: CAL.followup, startTime: '2026-03-20T18:00:00Z' }),
        ],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.confidence).toBe('low');
      expect(result.display.remaining).toBe(2); // from field
      expect(result.display.source).toBe('low-confidence-fallback');
    });

    it('falls back to derived when field is missing despite lock', () => {
      // Lock=true but no sessions_remaining field value → can't trust empty.
      const result = deriveLedger({
        contact: contact({ customFields: [FIELDS.locked] }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [],
        fieldDefs: FIELD_DEFS_FULL,
      });
      // Falls back to derived rather than returning NaN
      expect(result.display.remaining).toBe(4);
      expect(Number.isFinite(result.display.remaining)).toBe(true);
    });

    it('display.source = "derived-matches-field" when locked but value matches derived', () => {
      // Cosmetic but load-bearing: the drift watchdog reports display.source
      // to humans. If we always say "manual-lock" even when no actual
      // fallback happened, the briefing misleads.
      const result = deriveLedger({
        contact: contact({
          customFields: [
            { id: FIELD_DEFS.sessions_remaining, value: '3' }, // matches derived
            { id: FIELD_DEFS.series_type, value: '4-session' },
            { id: 'oDyLqIeq3yTkyhgXhAmk', value: ['true'] },
          ],
        }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [appt({ calendarId: CAL.followup })],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.manualLock).toBe(true);
      expect(result.remaining).toBe(3);
      expect(result.display.remaining).toBe(3);
      expect(result.display.source).toBe('derived-matches-field');
    });

    it('display.source = "manual-lock" only when field actually diverges', () => {
      const result = deriveLedger({
        contact: contact({
          customFields: [
            { id: FIELD_DEFS.sessions_remaining, value: '2' }, // diverges from derived (3)
            { id: FIELD_DEFS.series_type, value: '4-session' },
            { id: 'oDyLqIeq3yTkyhgXhAmk', value: ['true'] },
          ],
        }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [appt({ calendarId: CAL.followup })],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.display.source).toBe('manual-lock');
    });

    it('display.attended is consistent with display.remaining (Albert case)', () => {
      // Regression for the "1/4 progress bar + 2 sessions left" inconsistency.
      // When lock overrides remaining, attended must back-compute so
      // attended + remaining == purchased — otherwise the progress bar
      // visually disagrees with the count.
      const result = deriveLedger({
        contact: contact({
          customFields: [
            { id: FIELD_DEFS.sessions_remaining, value: '2' },
            { id: FIELD_DEFS.series_type, value: '4-session' },
            { id: 'oDyLqIeq3yTkyhgXhAmk', value: ['true'] },
          ],
        }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [appt({ calendarId: CAL.followup })],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.attended).toBe(1); // derived: 1 attended session
      expect(result.display.remaining).toBe(2); // field-locked
      expect(result.display.attended).toBe(2); // back-computed: 4 - 2
      expect(result.display.attended + result.display.remaining).toBe(result.purchased);
    });

    it('display.attended caps at 0 when field over-credits beyond purchased', () => {
      // If Garrett locks remaining to a value higher than purchased,
      // back-computed attended would go negative — floor at 0.
      const result = deriveLedger({
        contact: contact({
          customFields: [
            { id: FIELD_DEFS.sessions_remaining, value: '6' }, // > 4 purchased
            { id: FIELD_DEFS.series_type, value: '4-session' },
            { id: 'oDyLqIeq3yTkyhgXhAmk', value: ['true'] },
          ],
        }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.display.remaining).toBe(6);
      expect(result.display.attended).toBe(0); // floored
    });

    it('display.attended falls back to derived when not overriding', () => {
      const result = deriveLedger({
        contact: contact({ customFields: [] }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [appt({ calendarId: CAL.followup })],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.confidence).toBe('high');
      expect(result.display.source).toBe('derived');
      expect(result.display.attended).toBe(1); // matches derived
    });

    it('handles field="0" + lock correctly (not NaN, not silent zero)', () => {
      // R1 flagged this combination: empty-string would NaN, but "0" should
      // be a valid locked value of zero. Worth a regression test.
      const result = deriveLedger({
        contact: contact({
          customFields: [
            { id: FIELD_DEFS.sessions_remaining, value: '0' },
            { id: FIELD_DEFS.series_type, value: '4-session' },
            { id: 'oDyLqIeq3yTkyhgXhAmk', value: ['true'] },
          ],
        }),
        orders: [order({ sourceName: '4-Session Series', amount: 720 })],
        appointments: [],
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(result.manualLock).toBe(true);
      expect(result.display.remaining).toBe(0);
      expect(Number.isFinite(result.display.remaining)).toBe(true);
      expect(result.display.source).toBe('manual-lock'); // 0 diverges from derived 4
    });

    it('display.remaining is never NaN regardless of field state', () => {
      // Empty-string field, low confidence — historically produced NaN.
      const result = deriveLedger({
        contact: contact({
          customFields: [{ id: FIELD_DEFS.sessions_remaining, value: '' }],
        }),
        orders: [],
        appointments: [appt({ calendarId: CAL.followup })], // attended without purchased
        fieldDefs: FIELD_DEFS_FULL,
      });
      expect(Number.isFinite(result.display.remaining)).toBe(true);
    });
  });

  it('flags failed-hydration orders as an ambiguity and drops confidence', () => {
    // Regression test for the post-fix review finding: when hydrateOrders
    // can't reach /payments/orders/{id}, the order arrives at deriveLedger
    // with __hydration_failed=true. The derivation should surface that as
    // an ambiguity so the worker's confidence-guard blocks the write.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        {
          sourceName: '',
          sourceType: 'point_of_sale',
          status: 'completed',
          amount: 1295,
          createdAt: '2026-05-08T00:00:00Z',
          __hydration_failed: true,
          __hydration_reason: 'GHL detail status 429',
        },
      ],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.confidence).toBe('low');
    expect(result.ambiguities.some((a) => /hydration failed/.test(a))).toBe(true);
  });
});

// ── deriveLedger — invoice merging + active-product allowlist ──────────────

describe('deriveLedger — invoices', () => {
  it('merges invoice purchases with order purchases', () => {
    // Contact has an order-based initial + an invoice-based 4-upgrade
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: 'Initial Session', amount: 225 })],
      invoices: [invoice({ productId: PID.fourUpgrade, amountPaid: 495 })],
      appointments: [appt({ calendarId: CAL.initial, startTime: '2026-03-20T18:00:00Z' })],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4); // 1 initial + 3 upgrade
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(3);
    expect(result.seriesType).toBe('4-session');
  });

  it('retired invoice productIds contribute 0 sessions', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [],
      invoices: [
        // Danny's historical $200 follow-ups are all retired products
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-08-17T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-09-07T00:00:00Z' }),
        invoice({ productId: PID.retiredBalanceForLife, amountPaid: 475, issueDate: '2025-05-31T00:00:00Z' }),
      ],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(0);
    expect(result.seriesType).toBe('none');
  });

  it('only counts paid invoices, ignores drafts and partial', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [],
      invoices: [
        invoice({ productId: PID.eightSeries, amountPaid: 1295, status: 'paid' }),
        invoice({ productId: PID.eightSeries, amountPaid: 0, status: 'draft' }),
        invoice({ productId: PID.fourSeries, amountPaid: 0, status: 'sent' }),
      ],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8); // only the paid 8-Session Series counts
  });

  it("Danny's real case: 14 invoices but only the 8-pack counts (session on purchase day counts as 1/8)", () => {
    // Full reproduction of Danny Blumrich's ground-truth data from 2026-04-10.
    // 12 retired follow-up invoices, 1 retired "Balanced for Life", 1 real
    // 8-Session Series. Pre-fix the ledger couldn't see invoices at all.
    // The 3/18 session happened ~7 hours before the invoice was issued
    // that same day — Garrett booked a free session, sold the 8-pack during
    // it, and applied that session as 1/8. Day-level cutoff comparison
    // catches this.
    const result = deriveLedger({
      contact: contact(),
      orders: [], // all 5 of Danny's orders are calendar placeholders → 0
      invoices: [
        invoice({ productId: PID.retiredBalanceForLife, amountPaid: 475, issueDate: '2025-05-31T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-06-15T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-06-29T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-07-13T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-08-03T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-08-17T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-09-07T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-10-11T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowup, amountPaid: 200, issueDate: '2025-11-02T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowupCalendars, amountPaid: 200, issueDate: '2025-11-20T00:00:00Z' }),
        invoice({ productId: null, itemName: 'Custom Item', amountPaid: 200, issueDate: '2025-12-11T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowupCalendars, amountPaid: 200, issueDate: '2026-01-08T00:00:00Z' }),
        invoice({ productId: PID.retiredFollowupCalendars, amountPaid: 200, issueDate: '2026-02-05T00:00:00Z' }),
        // The only real active purchase:
        invoice({ productId: PID.eightSeries, amountPaid: 1295, issueDate: '2026-03-18T18:44:00Z' }),
      ],
      appointments: [
        // 10 real attended sessions, 9 of them BEFORE the 8-pack purchase
        appt({ calendarId: CAL.followupPackage, startTime: '2025-06-29T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2025-08-17T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2025-09-07T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2025-10-11T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2025-11-02T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2025-11-20T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2025-12-11T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2026-01-08T18:00:00Z' }),
        appt({ calendarId: CAL.followupPackage, startTime: '2026-02-05T18:00:00Z' }),
        // Session happened ~7 hours BEFORE the invoice on the same day.
        // Day-granularity cutoff (YYYY-MM-DD) still includes it as part
        // of the 8-pack because Garrett sold the package during the session.
        appt({ calendarId: CAL.followup, startTime: '2026-03-18T11:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8);
    expect(result.seriesType).toBe('8-session');
    expect(result.attended).toBe(1); // the 3/18 session applied to the 8-pack
    expect(result.remaining).toBe(7);
    // lastSessionDate reflects the real last visit
    expect(result.lastSessionDate).toBe('2026-03-18T11:00:00Z');
  });
});

// ── deriveLedger — earliest-active-package cutoff ──────────────────────────

describe('deriveLedger — attended cutoff', () => {
  it('excludes attended sessions from before the earliest package purchase', () => {
    // Betsy's real case: free initial on Feb 20, 4-series purchased Mar 13,
    // 2 follow-ups attended after. The initial predates the series and
    // should NOT count against it.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({ sourceName: '4-Session Series', amount: 720, createdAt: '2026-03-13T00:00:00Z' }),
      ],
      invoices: [],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-02-20T18:00:00Z' }), // before cutoff
        appt({ calendarId: CAL.followup, startTime: '2026-03-27T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-04-09T18:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(2); // Feb 20 initial excluded
    expect(result.remaining).toBe(2);
  });

  it('mid-series repurchase preserves leftover sessions (uses earliest, not most recent)', () => {
    // Alice has 2 leftover sessions from a Jan 4-series, then buys another
    // 4-series in March. Leftover + new = 6 remaining.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({ sourceName: '4-Session Series', amount: 720, createdAt: '2026-01-01T00:00:00Z' }),
        order({ sourceName: '4-Session Series', amount: 720, createdAt: '2026-03-01T00:00:00Z' }),
      ],
      invoices: [],
      appointments: [
        appt({ calendarId: CAL.followup, startTime: '2026-01-15T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-02-01T18:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(2); // both on/after Jan 1 earliest
    expect(result.remaining).toBe(6);
  });

  it('session attended same DAY as package purchase counts (day-granularity cutoff)', () => {
    // Garrett sometimes books a free session, sells a package mid-session,
    // and applies that session to the new package. The session and the
    // package purchase share a calendar day — and the session should count.
    const result = deriveLedger({
      contact: contact(),
      orders: [],
      invoices: [
        invoice({
          productId: PID.eightSeries,
          amountPaid: 1295,
          // Invoice issued at 11:44 AM PT (18:44 UTC)
          issueDate: '2026-03-18T18:44:00Z',
        }),
      ],
      appointments: [
        // Session attended at ~4 AM PT same day — 7 hours BEFORE invoice
        appt({ calendarId: CAL.followup, startTime: '2026-03-18T11:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(7);
  });

  it('session attended day BEFORE package purchase does NOT count', () => {
    // Betsy-style: free initial the day before the series buy, both in
    // Pacific time (order.createdAt is UTC; appointment.startTime is a
    // naive-local string, same as real GHL data — see toDayPacific()).
    // Previous version of this test used a UTC-adjacent-but-same-Pacific-day
    // pair (order at 2026-03-13T00:00:00Z = 2026-03-12 5pm PT, appointment at
    // 2026-03-12T23:59:59Z = 2026-03-12 4pm PT — actually the SAME Pacific
    // day) which happened to pass under the old naive-UTC-slice bug this
    // test was meant to guard against. Fixed to a genuine day-before pair.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: '4-Session Series',
          amount: 720,
          createdAt: '2026-03-13T20:00:00Z', // 2026-03-13 1pm PT
        }),
      ],
      invoices: [],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-12T18:00:00' }), // naive-local 6pm PT, day before
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.attended).toBe(0);
    expect(result.remaining).toBe(4);
  });

  it("Albert Yang's real case: same-evening purchase crossing the UTC day boundary still counts the session (2026-07-01 bug)", () => {
    // Initial session 2026-05-21 4:30pm PT (naive-local startTime, no Z —
    // real GHL format). Package purchased that same evening at 5:46pm PT,
    // which is 2026-05-22T00:46:21.918Z in UTC — the UTC calendar day rolls
    // forward even though it's still the same Pacific evening. Before the
    // toDayPacific() fix, cutoffDay derived as "2026-05-22" (UTC slice) while
    // the appointment's naive slice stayed "2026-05-21", so the appointment
    // fell before cutoff and was silently excluded from `attended`.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({ sourceName: '4 Session Series Link', amount: 720, createdAt: '2026-05-22T00:46:21.918Z' }),
      ],
      invoices: [],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-05-21T16:30:00' }), // naive-local, no Z
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(3);
  });

  it('pay-as-you-go client with no package has no cutoff (all attendances count)', () => {
    // Client buys individual follow-ups, no series package. No cutoff is
    // applied, so all attendances count — balance should net to 0.
    const result = deriveLedger({
      contact: contact(),
      orders: [],
      invoices: [
        invoice({ productId: PID.followupInPerson, amountPaid: 190, issueDate: '2026-02-01T00:00:00Z' }),
        invoice({ productId: PID.followupInPerson, amountPaid: 190, issueDate: '2026-03-01T00:00:00Z' }),
      ],
      appointments: [
        appt({ calendarId: CAL.followup, startTime: '2026-02-05T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-03-05T18:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(2);
    expect(result.attended).toBe(2);
    expect(result.remaining).toBe(0);
    expect(result.seriesType).toBe('Single');
  });
});

describe('deriveLedger — upgrade orders', () => {
  it('upgrade with matching initial order → purchased 4', () => {
    // Initial ($225) + upgrade ($495) = 1 + 3 = 4 sessions total
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Initial Session',
          amount: 225,
          createdAt: '2026-03-01T14:00:00Z',
        }),
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-01T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(3);
  });

  it('CROSS-DAY upgrade with matching initial order → attended initial still counts (remaining 3, not 4)', () => {
    // The 2026-07-02 audit bug: initial purchased + attended on Mar 1,
    // upgrade bought Mar 10. The cutoff used to sit on the upgrade day
    // (earliest PACKAGE_TYPES date), dropping the Mar 1 attendance —
    // deriving remaining=4 at high confidence, and the reconcile sweep then
    // overwrote the webhook's correct 3 with 4. The initial→N upgrade prices
    // in the already-paid initial, so the package effectively starts on the
    // initial's purchase day.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Initial Session',
          amount: 225,
          createdAt: '2026-03-01T14:00:00Z',
        }),
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-10T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(3);
    expect(result.confidence).toBe('high');
  });

  it('CROSS-DAY 8-upgrade with matching initial → remaining 7, not 8', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Initial Session',
          amount: 225,
          createdAt: '2026-03-01T14:00:00Z',
        }),
        order({
          sourceName: 'Upgrade to 8-Session',
          amount: 1070,
          createdAt: '2026-03-10T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(7);
  });

  it('cross-day upgrade also absorbs a paid one-off follow-up between initial and upgrade', () => {
    // Initial Mar 1 (paid + attended), one-off follow-up Mar 5 (paid +
    // attended), upgrade Mar 10. purchased = 1 + 1 + 3 = 5, attended = 2,
    // remaining = 3 — the pre-upgrade sessions the client paid for are
    // matched by their purchases, not silently dropped by the cutoff.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Initial Session',
          amount: 225,
          createdAt: '2026-03-01T14:00:00Z',
        }),
        order({
          sourceName: 'Follow-up Session',
          amount: 190,
          createdAt: '2026-03-05T14:00:00Z',
        }),
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-10T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00' }),
        appt({ calendarId: CAL.followup, startTime: '2026-03-05T15:00:00' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(5);
    expect(result.attended).toBe(2);
    expect(result.remaining).toBe(3);
  });

  it('multiple initials: extension uses the LATEST initial on-or-before the upgrade, not an ancient one', () => {
    // Dirty-history guard (2026-07-02 cold review): a legacy pay-as-you-go
    // initial from a year earlier must NOT drag the cutoff back and count
    // old comped sessions against the new package. The upgrade credits the
    // RECENT initial. (The old initial's +1 purchase still sums into
    // `purchased` while its attendance falls before cutoff — that residual
    // inflation is pre-existing cutoff design, surfaced by the sweep's
    // delta>2 needs-review path, not this rule.)
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Initial Session',
          amount: 225,
          createdAt: '2025-01-10T14:00:00Z',
        }),
        order({
          sourceName: 'Initial Session',
          amount: 225,
          createdAt: '2026-03-01T14:00:00Z',
        }),
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-10T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2025-01-10T15:00:00' }),
        // comped follow-up in 2025 — must stay excluded
        appt({ calendarId: CAL.followup, startTime: '2025-02-10T15:00:00' }),
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    // cutoff = 2026-03-01 (latest initial ≤ upgrade day): only the recent
    // initial counts as attended. NOT 2025-01-10, which would also count
    // the old initial + comp (attended 3 → remaining 2).
    expect(result.purchased).toBe(5);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(4);
  });

  it('bare date-only issueDate on an invoice-sourced initial does not shift the cutoff a day early', () => {
    // toDayPacific() must treat "YYYY-MM-DD" as already a calendar day.
    // Parsing it through Date makes it UTC midnight = 4pm PT the PREVIOUS
    // day, landing the cutoff on Feb 28 and pulling the comped Feb 28
    // session into `attended` (remaining 2 instead of 3).
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-10T14:30:00Z',
        }),
      ],
      invoices: [
        invoice({ productId: PID.initialInPerson, amountPaid: 225, issueDate: '2026-03-01' }),
      ],
      appointments: [
        // comped session the day before the paid initial — must stay excluded
        appt({ calendarId: CAL.followup, startTime: '2026-02-28T15:00:00' }),
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(3);
  });

  it('cross-day upgrade WITHOUT an initial order does NOT extend the cutoff', () => {
    // Initial paid off-platform (no GHL order). The upgrade math is
    // self-contained (purchased=3) and the off-platform initial attendance
    // must stay excluded — extending the cutoff here would double-charge
    // the client one session (remaining 2 instead of 3).
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-10T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(3);
    expect(result.attended).toBe(0);
    expect(result.remaining).toBe(3);
  });

  it('upgrade without matching initial order → purchased 3 (upgrade only)', () => {
    // No initial order in system — upgrade gives 3 sessions.
    // The initial session was paid off-platform but the upgrade math
    // is self-contained: $495 = 3 additional sessions.
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-01T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(3);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(2);
  });

  it('8-upgrade without matching initial → purchased 7', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Upgrade to 8-Session',
          amount: 1070,
          createdAt: '2026-03-01T14:30:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-01T15:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(7);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(6);
  });

  it('multiple upgrades without matching initials → 3+3=6', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-02-01T14:00:00Z',
        }),
        order({
          sourceName: 'Upgrade to 4-Session',
          amount: 495,
          createdAt: '2026-03-01T14:00:00Z',
        }),
      ],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(6);
    expect(result.remaining).toBe(6);
  });

  it('direct 4-series purchase (Betsy-like) → purchased 4', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: '4-Session Series',
          amount: 720,
          createdAt: '2026-03-13T14:00:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.followup, startTime: '2026-03-15T14:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-03-22T14:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(4);
    expect(result.attended).toBe(2);
    expect(result.remaining).toBe(2);
  });

  it('direct 8-series purchase (Danny-like) → purchased 8', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [],
      invoices: [
        invoice({
          productId: PID.eightSeries,
          itemName: '8-Session Series',
          amountPaid: 1295,
          issueDate: '2026-03-18T18:00:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.followup, startTime: '2026-03-18T17:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(1);
    expect(result.remaining).toBe(7);
  });

  it("Zach Taylor: upgrade (3) + 8-series (8) = 11 purchased, 5 attended, 6 remaining", () => {
    // Zach: 4-upgrade on 3/5 (+3) + 8-series on 3/27 (+8) = 11 purchased
    // 5 attended series sessions (initial + 4 follow-ups, entrainment excluded)
    // 11 - 5 = 6 remaining
    const result = deriveLedger({
      contact: contact(),
      orders: [
        order({
          sourceName: 'Upgrade: Initial → 4-Session',
          amount: 495,
          createdAt: '2026-03-05T16:00:00Z',
        }),
        order({
          sourceName: 'Follow-up Session',
          amount: 190,
          sourceType: 'calendar',
          createdAt: '2026-03-14T18:00:00Z',
        }),
        order({
          sourceName: 'Follow-up Session',
          amount: 190,
          sourceType: 'calendar',
          createdAt: '2026-03-21T18:00:00Z',
        }),
        order({
          sourceName: '8-Session Series',
          amount: 1295,
          createdAt: '2026-03-27T21:40:00Z',
        }),
        order({
          sourceName: 'Follow-up Session',
          amount: 190,
          sourceType: 'calendar',
          createdAt: '2026-03-27T23:17:00Z',
        }),
        order({
          sourceName: 'Entrainment',
          amount: 90,
          sourceType: 'calendar',
          createdAt: '2026-04-08T20:15:00Z',
        }),
        order({
          sourceName: 'Follow-up Session',
          amount: 190,
          sourceType: 'calendar',
          createdAt: '2026-04-08T21:34:00Z',
        }),
      ],
      appointments: [
        appt({ calendarId: CAL.initial, startTime: '2026-03-05T15:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-03-13T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-03-18T17:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-03-27T20:30:00Z' }),
        appt({ calendarId: CAL.entrainment, startTime: '2026-04-08T20:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-04-08T21:00:00Z' }),
      ],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.purchased).toBe(11);
    expect(result.attended).toBe(5);
    expect(result.remaining).toBe(6);
    expect(result.seriesType).toBe('8-session');
  });
});

// ── computeSessionLedger — order hydration ─────────────────────────────────
// Integration test: when /payments/orders LIST returns POS orders WITHOUT
// items[], computeSessionLedger must fetch /payments/orders/{id} DETAIL to
// recover the productId before deriving. Regression test for 2026-06-03
// Jenn Kadri incident.

describe('computeSessionLedger — POS order hydration', () => {
  const CONTACT_ID = 'jenn-test';
  const ORDER_ID = 'pos-order-1';

  beforeEach(() => {
    ghlResponses.clear();
  });

  function setResponses({ listOrder, detailOrder, appointments = [] }) {
    ghlResponses.set(`/contacts/${CONTACT_ID}/appointments`, {
      ok: true,
      json: async () => ({ appointments }),
    });
    ghlResponses.set(`/contacts/${CONTACT_ID}`, {
      ok: true,
      json: async () => ({ contact: { id: CONTACT_ID, customFields: [] } }),
    });
    ghlResponses.set('/payments/orders?', {
      ok: true,
      json: async () => ({ data: [listOrder] }),
    });
    ghlResponses.set(`/payments/orders/${ORDER_ID}`, {
      ok: true,
      json: async () => detailOrder,
    });
    ghlResponses.set('/invoices/', {
      ok: true,
      json: async () => ({ invoices: [] }),
    });
  }

  it('hydrates POS list orders via /payments/orders/{id} before classifying', async () => {
    setResponses({
      // LIST shape: no items[] (the real GHL bug)
      listOrder: {
        _id: ORDER_ID,
        amount: 1295,
        status: 'completed',
        paymentStatus: 'paid',
        sourceType: 'point_of_sale',
        createdAt: '2026-05-08T02:09:51.992Z',
      },
      // DETAIL shape: items[] with product._id (what we need)
      detailOrder: {
        _id: ORDER_ID,
        amount: 1295,
        status: 'completed',
        paymentStatus: 'paid',
        sourceType: 'point_of_sale',
        createdAt: '2026-05-08T02:09:51.992Z',
        items: [{ product: { _id: PID.eightSeries, name: '8-Session Series' } }],
      },
      appointments: [
        appt({ calendarId: CAL.followup, startTime: '2026-05-14T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-05-18T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-05-28T18:00:00Z' }),
        appt({ calendarId: CAL.followup, startTime: '2026-06-02T19:00:00Z' }),
      ],
    });

    const result = await computeSessionLedger(
      { env: {} },
      CONTACT_ID,
      { fieldDefs: FIELD_DEFS },
    );

    expect(result.seriesType).toBe('8-session');
    expect(result.purchased).toBe(8);
    expect(result.attended).toBe(4);
    expect(result.remaining).toBe(4);
    expect(result.ambiguities).toEqual([]);
  });

  it('skips hydration when LIST already returns items[] (payment_link orders)', async () => {
    const fullOrder = {
      _id: ORDER_ID,
      amount: 720,
      status: 'completed',
      paymentStatus: 'paid',
      sourceType: 'payment_link',
      sourceName: '4-Session Series',
      createdAt: '2026-05-08T00:00:00Z',
      items: [{ product: { _id: PID.fourSeries, name: '4-Session Series' } }],
    };
    setResponses({
      listOrder: fullOrder,
      // If hydration fires here it'd be a bug — return a wrong product to
      // ensure the test fails if hydration is called when it shouldn't be.
      detailOrder: {
        _id: ORDER_ID,
        items: [{ product: { _id: PID.eightSeries, name: 'WRONG' } }],
      },
      appointments: [],
    });

    const result = await computeSessionLedger(
      { env: {} },
      CONTACT_ID,
      { fieldDefs: FIELD_DEFS },
    );

    expect(result.seriesType).toBe('4-session');
    expect(result.purchased).toBe(4);
  });

  it('falls back gracefully when detail fetch fails', async () => {
    setResponses({
      listOrder: {
        _id: ORDER_ID,
        amount: 1295,
        status: 'completed',
        sourceType: 'point_of_sale',
        createdAt: '2026-05-08T00:00:00Z',
      },
      // Detail endpoint returns 500 — same as a network glitch
      detailOrder: undefined,
      appointments: [],
    });
    // Override the detail response to be a failure
    ghlResponses.set(`/payments/orders/${ORDER_ID}`, {
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await computeSessionLedger(
      { env: {} },
      CONTACT_ID,
      { fieldDefs: FIELD_DEFS },
    );

    // Without items[] and no recoverable detail, hydration marks
    // __hydration_failed → ambiguity → confidence drops → display
    // falls back to field (which is null here, so derived).
    expect(result.purchased).toBe(0);
    expect(result.confidence).toBe('low');
    expect(result.ambiguities.some((a) => /hydration failed/.test(a))).toBe(true);
  });

  it('returns a display block on the no-contactId early-return', async () => {
    // Regression test: any consumer doing ledger.display.X without
    // optional chaining would throw if early-returns omit display.
    const result = await computeSessionLedger({ env: {} }, "", { fieldDefs: FIELD_DEFS });
    expect(result.display).toBeDefined();
    expect(result.display.seriesType).toBe('none');
    expect(result.display.remaining).toBe(0);
    expect(result.display.source).toBe('empty');
    expect(result.manualLock).toBe(false);
  });
});

describe('SERIES_CALENDAR_IDS', () => {
  it('contains the 6 series calendar IDs (2 initial + 4 follow-up)', () => {
    expect(SERIES_CALENDAR_IDS.size).toBe(6);
    expect(SERIES_CALENDAR_IDS.has(CAL.initial)).toBe(true);
    expect(SERIES_CALENDAR_IDS.has(CAL.initialVirtual)).toBe(true);
    expect(SERIES_CALENDAR_IDS.has(CAL.followup)).toBe(true);
    expect(SERIES_CALENDAR_IDS.has(CAL.entrainment)).toBe(false);
    expect(SERIES_CALENDAR_IDS.has(CAL.discovery)).toBe(false);
    expect(SERIES_CALENDAR_IDS.has(CAL.partner)).toBe(false);
    // "Paid at Partner" — paid at partner POS, no GHL order, excluded from series
    expect(SERIES_CALENDAR_IDS.has(CAL.initialPaidAtPartner)).toBe(false);
  });
});

// ── fetchFailures — partial GHL fetch failure must not derive confidently ──
//
// 2026-07-02 audit: if /payments/orders 500s while invoices/appointments
// succeed, every caller silently passed orders=[] and a paid-but-unattended
// client derived purchased=0/remaining=0 at HIGH confidence — staff could
// chase a fully-paid client for money. Callers now report failed fetches
// via fetchFailures, which forces an ambiguity → low confidence → field
// fallback (same path as hydration failures).

describe('deriveLedger — fetchFailures', () => {
  it('orders-fetch failure forces low confidence + field fallback instead of a confident zero', () => {
    const result = deriveLedger({
      contact: contact({ customFields: [{ id: 'wrQSkx6BhXwDGIn1d0V4', value: '8' }] }),
      orders: [],
      invoices: [],
      appointments: [],
      fieldDefs: FIELD_DEFS,
      fetchFailures: ['orders (500)'],
    });
    expect(result.confidence).toBe('low');
    expect(result.ambiguities.join(' ')).toMatch(/orders \(500\)/);
    expect(result.display.remaining).toBe(8);
    expect(result.display.source).toBe('low-confidence-fallback');
  });

  it('appointments-fetch failure forces low confidence instead of a confident full balance', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [],
      invoices: [
        invoice({ productId: PID.eightSeries, amountPaid: 1295, issueDate: '2026-03-01T18:00:00Z' }),
      ],
      appointments: [], // fetch failed — the client has really attended sessions
      fieldDefs: FIELD_DEFS,
      fetchFailures: ['appointments (429)'],
    });
    expect(result.confidence).toBe('low');
    expect(result.ambiguities.join(' ')).toMatch(/appointments \(429\)/);
  });
});

describe('computeSessionLedger — partial fetch failure', () => {
  it('orders 500 while invoices/appointments succeed → low confidence, ambiguity recorded', async () => {
    ghlResponses.clear();
    ghlResponses.set('/contacts/pf-1/appointments', { ok: true, json: async () => ({ appointments: [] }) });
    ghlResponses.set('/contacts/pf-1', {
      ok: true,
      json: async () => ({ contact: { id: 'pf-1', customFields: [] } }),
    });
    ghlResponses.set('/payments/orders?', { ok: false, status: 500, json: async () => ({}) });
    ghlResponses.set('/invoices/', {
      ok: true,
      json: async () => ({
        invoices: [
          {
            name: 'New Invoice',
            status: 'paid',
            amountPaid: 1295,
            total: 1295,
            issueDate: '2026-03-01T18:00:00Z',
            invoiceItems: [{ name: '8-Session Series', productId: '69987357c839790426996114', amount: 1295, qty: 1 }],
          },
        ],
      }),
    });
    ghlResponses.set('/customFields', { ok: true, json: async () => ({ customFields: [] }) });

    const ledger = await computeSessionLedger({}, 'pf-1');

    expect(ledger.confidence).toBe('low');
    expect(ledger.ambiguities.join(' ')).toMatch(/orders/);
  });
});
