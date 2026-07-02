import { describe, it, expect } from 'vitest';
import { countBillableSessionsAttended, computeOwedStatus } from './session-owed.js';
import { SERIES_CALENDAR_IDS } from './session-ledger.js';

const SERIES_CAL = [...SERIES_CALENDAR_IDS][0]; // a real billable calendar id
const PARTNER_COMP_CAL = 'lfsnaiGiLNL2z12pLKDP'; // partner initial (comp) — excluded
const past = '2026-01-01T18:00:00Z';
const future = '2099-01-01T18:00:00Z';

const appt = (o = {}) => ({
  calendarId: o.calendarId ?? SERIES_CAL,
  appointmentStatus: o.status ?? 'showed',
  startTime: o.startTime ?? past,
});

describe('countBillableSessionsAttended', () => {
  it('counts past showed/completed sessions on series calendars', () => {
    const appts = [
      appt({ status: 'showed' }),
      appt({ status: 'completed' }),
      appt({ status: 'confirmed' }),            // not attended
      appt({ status: 'cancelled' }),            // not attended
    ];
    expect(countBillableSessionsAttended(appts)).toBe(2);
  });
  it('excludes comp sessions (partner-initial calendar) and non-series calendars', () => {
    const appts = [
      appt({ calendarId: SERIES_CAL, status: 'showed' }),
      appt({ calendarId: PARTNER_COMP_CAL, status: 'showed' }), // comp — excluded
      appt({ calendarId: 'B5aGXLoS4kzAjZAMMXxk', status: 'showed' }), // entrainment — excluded
    ];
    expect(countBillableSessionsAttended(appts)).toBe(1);
  });
  it('excludes future appointments even if marked confirmed/showed', () => {
    expect(countBillableSessionsAttended([appt({ status: 'showed', startTime: future })])).toBe(0);
  });
});

describe('computeOwedStatus', () => {
  it('paid-legacy when a SIZEABLE unrecognized (old-price) charge covers attended sessions', () => {
    const r = computeOwedStatus({ sessionsPurchased: 0, unknownCount: 1, unknownMax: 475, attendedBillable: 3 });
    expect(r.status).toBe('paid-legacy');
    expect(r.shortBy).toBeNull();
  });
  it('still OWED when the only unknown is a small stray charge (does not excuse real debt)', () => {
    const r = computeOwedStatus({ sessionsPurchased: 0, unknownCount: 1, unknownMax: 50, attendedBillable: 3 });
    expect(r.status).toBe('owed');
    expect(r.shortBy).toBe(3);
  });
  it('square when paid sessions cover attended', () => {
    expect(computeOwedStatus({ sessionsPurchased: 8, unknownCount: 0, attendedBillable: 4 }).status).toBe('square');
    expect(computeOwedStatus({ sessionsPurchased: 4, unknownCount: 0, attendedBillable: 4 }).status).toBe('square');
  });
  it('owed (high confidence) when nothing was paid but sessions were attended', () => {
    const r = computeOwedStatus({ sessionsPurchased: 0, unknownCount: 0, attendedBillable: 2 });
    expect(r.status).toBe('owed');
    expect(r.shortBy).toBe(2);
    expect(r.confidence).toBe('high');
  });
  it('owed (medium confidence) when they paid for some but attended more', () => {
    const r = computeOwedStatus({ sessionsPurchased: 3, unknownCount: 0, attendedBillable: 5 });
    expect(r.status).toBe('owed');
    expect(r.shortBy).toBe(2);
    expect(r.confidence).toBe('medium');
  });
  it('square when nothing attended yet', () => {
    expect(computeOwedStatus({ sessionsPurchased: 0, unknownCount: 0, attendedBillable: 0 }).status).toBe('square');
  });
});

describe('countBillableSessionsAttended — comped exclusion (2026-07-02 P2)', () => {
  const nowMs = Date.parse('2026-06-01T00:00:00Z');
  const idAppt = (id) => ({ ...appt(), id, startTime: '2026-03-02T10:00:00' });

  it('excludes appointments Garrett explicitly marked comped in the payment records', () => {
    // A comped session on a normal follow-up calendar has no Stripe charge,
    // so counting it as billable made attended > purchased and the owed
    // machinery accused a comped client of not paying (the reason the
    // hand-pinned isSettled list exists).
    const appts = [idAppt('a1'), idAppt('a2'), idAppt('a3')];
    expect(countBillableSessionsAttended(appts, nowMs)).toBe(3);
    expect(countBillableSessionsAttended(appts, nowMs, new Set(['a2']))).toBe(2);
  });

  it('still counts everything when no exclusions are passed', () => {
    expect(countBillableSessionsAttended([idAppt('a1')], nowMs)).toBe(1);
  });
});
