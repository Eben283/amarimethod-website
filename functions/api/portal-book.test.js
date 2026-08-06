import { describe, it, expect } from 'vitest';
import { matchingPortalAppointments, resolvePortalCalendar, portalBalanceExhausted, PORTAL_FOLLOWUP_CALENDARS } from './portal-book.js';

// B2 (2026-06-11 review): portal-book took calendarId straight from the request
// body with no allowlist and no balance check, so a logged-in client with 0
// sessions could POST the $225 Initial Session calendar (or partner/entrainment
// calendars) and get a confirmed appointment for free. The server now derives
// the calendar from sessionType (never trusting a client-supplied id) and blocks
// when the package balance is clearly exhausted.

const SESSIONS_REMAINING_FIELD_ID = 'wrQSkx6BhXwDGIn1d0V4';
const contactWithRemaining = (value) => ({
  customFields: value === undefined ? [] : [{ id: SESSIONS_REMAINING_FIELD_ID, value }],
});

describe('resolvePortalCalendar (server-side calendar allowlist)', () => {
  it('maps the two legitimate portal follow-up session types', () => {
    expect(resolvePortalCalendar('in-person')).toBe(PORTAL_FOLLOWUP_CALENDARS['in-person']);
    expect(resolvePortalCalendar('virtual')).toBe(PORTAL_FOLLOWUP_CALENDARS['virtual']);
  });

  it('returns null for ANY other session type — the calendar can never be chosen by the client', () => {
    // None of these can resolve, so the $225 initial / partner / entrainment
    // calendars are unreachable through this endpoint.
    expect(resolvePortalCalendar('initial')).toBe(null);
    expect(resolvePortalCalendar('discovery')).toBe(null);
    expect(resolvePortalCalendar('G7OAnnJuFbMF6nQSlZVQ')).toBe(null); // a raw calendarId
    expect(resolvePortalCalendar('')).toBe(null);
    expect(resolvePortalCalendar(undefined)).toBe(null);
    expect(resolvePortalCalendar(null)).toBe(null);
  });
});

describe('portalBalanceExhausted (block free bookings at 0)', () => {
  it('blocks when sessions_remaining is 0 or negative', () => {
    expect(portalBalanceExhausted(contactWithRemaining('0'))).toBe(true);
    expect(portalBalanceExhausted(contactWithRemaining(0))).toBe(true);
    expect(portalBalanceExhausted(contactWithRemaining('-1'))).toBe(true);
  });

  it('allows when sessions_remaining is positive', () => {
    expect(portalBalanceExhausted(contactWithRemaining('3'))).toBe(false);
    expect(portalBalanceExhausted(contactWithRemaining(8))).toBe(false);
  });

  it('fails OPEN (allows) when the field is missing or unparseable — allowlist is the primary guard', () => {
    expect(portalBalanceExhausted(contactWithRemaining(undefined))).toBe(false);
    expect(portalBalanceExhausted(contactWithRemaining(''))).toBe(false);
    expect(portalBalanceExhausted(contactWithRemaining('   '))).toBe(false);
    expect(portalBalanceExhausted(contactWithRemaining('not-a-number'))).toBe(false);
    expect(portalBalanceExhausted({})).toBe(false);
  });
});

describe('portalBookingBlocked (derived-ledger gate, 2026-07-02 audit)', () => {
  const contactWithField = (v) => ({ customFields: [{ id: 'wrQSkx6BhXwDGIn1d0V4', value: v }] });

  it('allows booking when the ledger the dashboard shows says sessions remain — even if the cached field says 0', async () => {
    const { portalBookingBlocked } = await import('./portal-book.js');
    const ledger = { source: 'orders+invoices+appointments', confidence: 'high', display: { remaining: 2 } };
    expect(portalBookingBlocked(ledger, contactWithField('0'))).toBe(false);
  });

  it('blocks booking when the displayed ledger is exhausted — even if the cached field says 2', async () => {
    const { portalBookingBlocked } = await import('./portal-book.js');
    const ledger = { source: 'orders+invoices+appointments', confidence: 'high', display: { remaining: 0 } };
    expect(portalBookingBlocked(ledger, contactWithField('2'))).toBe(true);
  });

  it('fails open for an underivable balance: low confidence AND a never-written field (old behavior preserved)', async () => {
    // A staff-booked package-calendar client with off-platform history has no
    // derivable package and an empty field — blocking would break even
    // RESCHEDULING (the modal books first).
    const { portalBookingBlocked } = await import('./portal-book.js');
    const ledger = { source: 'orders+invoices+appointments', confidence: 'low', display: { remaining: 0 } };
    expect(portalBookingBlocked(ledger, { customFields: [] })).toBe(false);
    // But a WRITTEN field at low confidence is still honored (display falls
    // back to it inside deriveLedger, so this stays consistent).
    expect(portalBookingBlocked(ledger, contactWithField('0'))).toBe(true);
  });

  it('falls back to the raw field when the ledger has no data (transient failure) — and fails open on a missing field', async () => {
    const { portalBookingBlocked } = await import('./portal-book.js');
    const empty = { source: 'empty', display: { remaining: 0 } };
    expect(portalBookingBlocked(empty, contactWithField('0'))).toBe(true);   // field says exhausted
    expect(portalBookingBlocked(empty, { customFields: [] })).toBe(false);   // field missing → fail open
    expect(portalBookingBlocked(null, { customFields: [] })).toBe(false);
  });
});

describe('matchingPortalAppointments (durable retry reconciliation)', () => {
  const selected = '2026-08-20T10:00:00-07:00';
  const appointments = [
    { id: 'same', calendarId: 'cal1', startTime: selected, appointmentStatus: 'new' },
    { id: 'other-time', calendarId: 'cal1', startTime: '2026-08-20T11:00:00-07:00', appointmentStatus: 'confirmed' },
    { id: 'cancelled', calendarId: 'cal1', startTime: selected, appointmentStatus: 'cancelled' },
  ];

  it('matches only the exact active calendar slot when no checkpoint exists', () => {
    expect(matchingPortalAppointments(appointments, { calendarId: 'cal1', startTime: selected }))
      .toEqual([appointments[0]]);
  });

  it('uses the checkpoint id as the authoritative retry identity', () => {
    expect(matchingPortalAppointments(appointments, {
      appointmentId: 'other-time', calendarId: 'cal1', startTime: selected,
    })).toEqual([appointments[1]]);
  });
});
