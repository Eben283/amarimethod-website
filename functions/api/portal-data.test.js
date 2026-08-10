import { describe, it, expect } from 'vitest';
import { getCustomField, isChecked, computeHasLivingPractice, countLifetimeCompleted } from './portal-data.js';

describe('countLifetimeCompleted', () => {
  const NOW = Date.parse('2026-06-06T12:00:00Z');
  const appt = (status, startISO, title = 'Follow-up Session') =>
    ({ appointmentStatus: status, startTime: startISO, title });

  it('counts past completed / showed / confirmed bodywork', () => {
    expect(countLifetimeCompleted([
      appt('completed', '2026-05-01T10:00:00Z'),
      appt('showed', '2026-05-08T10:00:00Z'),
      appt('confirmed', '2026-05-15T10:00:00Z'), // past confirmed Garrett didn't flip
    ], NOW)).toBe(3);
  });

  // THE FIX: a FUTURE confirmed (pre-booked) session hasn't happened — must NOT count.
  it('does NOT count a future confirmed (pre-booked) session', () => {
    expect(countLifetimeCompleted([
      appt('completed', '2026-05-01T10:00:00Z'),
      appt('confirmed', '2026-06-20T10:00:00Z'), // upcoming
    ], NOW)).toBe(1);
  });

  it('excludes non-journey types (discovery / consultation / 15-min)', () => {
    expect(countLifetimeCompleted([
      appt('completed', '2026-05-01T10:00:00Z', 'Discovery Call'),
      appt('showed', '2026-05-02T10:00:00Z', 'Follow-up Session'),
    ], NOW)).toBe(1);
  });
});

// ── getCustomField ──────────────────────────────────────────────────────────

describe('getCustomField', () => {
  const contact = {
    customFields: [
      { id: 'field-id-1', key: 'contact.sessions_completed', value: '5' },
      { id: 'field-id-2', key: 'series_type',                value: '4-session' },
      { id: 'field-id-3', key: 'contact.portal_access',      value: true },
      { id: 'field-id-4', key: null,                          field_value: 'fallback-val' },
    ],
  };

  it('matches by fieldDefs ID', () => {
    expect(getCustomField(contact, 'sc', { sc: 'field-id-1' })).toBe('5');
  });

  it('matches by direct f.id when no fieldDefs', () => {
    expect(getCustomField(contact, 'field-id-2')).toBe('4-session');
  });

  it('matches by f.key with contact. prefix', () => {
    expect(getCustomField(contact, 'sessions_completed')).toBe('5');
  });

  it('matches by f.key without contact. prefix', () => {
    expect(getCustomField(contact, 'series_type')).toBe('4-session');
  });

  it('returns field_value when value is absent', () => {
    expect(getCustomField(contact, 'field-id-4')).toBe('fallback-val');
  });

  it('returns null when no match', () => {
    expect(getCustomField(contact, 'nonexistent')).toBeNull();
  });

  it('returns null when customFields is absent', () => {
    expect(getCustomField({}, 'sessions_completed')).toBeNull();
  });

  it('returns null when customFields is null', () => {
    expect(getCustomField({ customFields: null }, 'sessions_completed')).toBeNull();
  });
});

// ── isChecked ───────────────────────────────────────────────────────────────

describe('isChecked', () => {
  it('returns true for boolean true', () => expect(isChecked(true)).toBe(true));
  it('returns true for string "true"',  () => expect(isChecked('true')).toBe(true));
  it('returns true for string "True"',  () => expect(isChecked('True')).toBe(true));
  it('returns true for string "TRUE"',  () => expect(isChecked('TRUE')).toBe(true));
  it('returns true for string "yes"',   () => expect(isChecked('yes')).toBe(true));
  it('returns true for string "1"',     () => expect(isChecked('1')).toBe(true));
  it('returns true for array ["true"]', () => expect(isChecked(['true'])).toBe(true));
  it('returns true for array ["yes"]',  () => expect(isChecked(['yes'])).toBe(true));
  it('returns true for array ["1"]',    () => expect(isChecked(['1'])).toBe(true));

  it('returns false for boolean false', () => expect(isChecked(false)).toBe(false));
  it('returns false for null',          () => expect(isChecked(null)).toBe(false));
  it('returns false for undefined',     () => expect(isChecked(undefined)).toBe(false));
  it('returns false for string "false"',() => expect(isChecked('false')).toBe(false));
  it('returns false for string "no"',   () => expect(isChecked('no')).toBe(false));
  it('returns false for string "0"',    () => expect(isChecked('0')).toBe(false));
  it('returns false for empty array',   () => expect(isChecked([])).toBe(false));
  it('returns false for array ["false"]', () => expect(isChecked(['false'])).toBe(false));
});

// ── computeHasLivingPractice ────────────────────────────────────────────────

describe('computeHasLivingPractice', () => {
  it('returns true when lpRaw is "true"', () => {
    expect(computeHasLivingPractice('true', [], 'none')).toBe(true);
  });

  it('returns true when lpRaw is boolean true', () => {
    expect(computeHasLivingPractice(true, [], 'none')).toBe(true);
  });

  it('returns true when tags includes "living-practice-access"', () => {
    expect(computeHasLivingPractice(null, ['living-practice-access'], 'none')).toBe(true);
  });

  it('returns true when seriesType is "8-session" regardless of lpRaw', () => {
    expect(computeHasLivingPractice(null, [], '8-session')).toBe(true);
  });

  it('returns true when seriesType is "8-session" even with false lpRaw', () => {
    expect(computeHasLivingPractice('false', [], '8-session')).toBe(true);
  });

  it('returns true when seriesType is "24-session" regardless of lpRaw', () => {
    expect(computeHasLivingPractice(null, [], '24-session')).toBe(true);
  });

  it('returns false when none of the three conditions apply', () => {
    expect(computeHasLivingPractice(null, [], 'none')).toBe(false);
  });

  it('returns false for 4-session with no LP field or tag', () => {
    expect(computeHasLivingPractice(null, ['some-other-tag'], '4-session')).toBe(false);
  });

  it('handles undefined tags gracefully', () => {
    expect(computeHasLivingPractice(null, undefined, '8-session')).toBe(true);
  });
});
