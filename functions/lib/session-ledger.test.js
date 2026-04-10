import { describe, it, expect } from 'vitest';
import { deriveLedger, classifyOrder, SERIES_CALENDAR_IDS } from './session-ledger.js';

// ── Fixture helpers ─────────────────────────────────────────────────────────

function order({ sourceName, amount, status = 'completed' }) {
  return { sourceName, amount, status };
}

function appt({ calendarId, status = 'showed', startTime = '2026-03-15T18:00:00Z' }) {
  return { calendarId, appointmentStatus: status, startTime };
}

function contact({ customFields = [] } = {}) {
  return { id: 'contact-1', customFields };
}

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

  it('source is "orders+appointments" when orders are present', () => {
    const result = deriveLedger({
      contact: contact(),
      orders: [order({ sourceName: '4-Session Series', amount: 720 })],
      appointments: [],
      fieldDefs: FIELD_DEFS,
    });
    expect(result.source).toBe('orders+appointments');
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
