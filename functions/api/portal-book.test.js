import { describe, it, expect } from 'vitest';
import { resolvePortalCalendar, portalBalanceExhausted, PORTAL_FOLLOWUP_CALENDARS } from './portal-book.js';

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
