import { describe, it, expect } from 'vitest';
import { appointmentEndTime, formatIsoAtOffset } from './datetime.js';

describe('appointmentEndTime — preserves instant AND offset', () => {
  it('60-min slot at -07:00 → end reads as the correct local wall clock (not +7h)', () => {
    // 10:00 PT + 60 min = 11:00 PT — the old bug produced "...T18:00:00-07:00".
    expect(appointmentEndTime('2026-05-21T10:00:00-07:00', 60)).toBe('2026-05-21T11:00:00-07:00');
  });

  it('50-min follow-up at -07:00', () => {
    expect(appointmentEndTime('2026-03-15T10:00:00-07:00', 50)).toBe('2026-03-15T10:50:00-07:00');
  });

  it('positive offset (+05:30)', () => {
    expect(appointmentEndTime('2026-05-21T10:00:00+05:30', 60)).toBe('2026-05-21T11:00:00+05:30');
  });

  it('crosses midnight in local time', () => {
    expect(appointmentEndTime('2026-05-21T23:30:00-07:00', 50)).toBe('2026-05-22T00:20:00-07:00');
  });

  it('Z (UTC) slot stays UTC', () => {
    expect(appointmentEndTime('2026-05-21T10:00:00Z', 60)).toBe('2026-05-21T11:00:00Z');
  });

  it('no offset suffix → still adds exactly the duration (output formatted as UTC)', () => {
    // A bare date-time with no offset is parsed as LOCAL time per the JS spec,
    // so the absolute clock is machine-dependent — but the instant delta is not.
    const start = '2026-05-21T10:00:00';
    const end = appointmentEndTime(start, 60);
    expect(end.endsWith('Z')).toBe(true);
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(60 * 60 * 1000);
  });

  it('the round-trip instant is start + duration (offset is cosmetic, not a shift)', () => {
    const start = '2026-05-21T10:00:00-07:00';
    const end = appointmentEndTime(start, 60);
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(60 * 60 * 1000);
  });

  it('throws on an unparseable start', () => {
    expect(() => appointmentEndTime('not-a-date', 60)).toThrow(/Invalid startTime/);
  });
});

describe('formatIsoAtOffset', () => {
  it('formats at a negative offset to seconds precision', () => {
    const ms = Date.parse('2026-05-21T18:00:00Z'); // = 11:00 at -07:00
    expect(formatIsoAtOffset(ms, '-07:00')).toBe('2026-05-21T11:00:00-07:00');
  });
  it('empty offset → UTC Z, no milliseconds', () => {
    const ms = Date.parse('2026-05-21T18:00:00.000Z');
    expect(formatIsoAtOffset(ms, '')).toBe('2026-05-21T18:00:00Z');
  });
});

// ── parsePacificWallClock / normalizeGhlTimestamp (2026-07-02 audit) ────────
//
// GHL returns appointment startTime as a NAIVE Pacific wall-clock string
// ("2026-07-02T15:00:00", no Z/offset). Workers run in UTC and browsers run
// in the client's zone, so parsing it directly shifts the instant by hours:
// day-of sessions vanished from the portal's "Up next" from ~8am, and a New
// York client's calendar export landed 3 hours early.

import { parsePacificWallClock, normalizeGhlTimestamp } from './datetime.js';

describe('parsePacificWallClock', () => {
  it('interprets a naive string as Pacific wall-clock (PDT)', () => {
    expect(parsePacificWallClock('2026-07-02T15:00:00')).toBe(Date.parse('2026-07-02T15:00:00-07:00'));
  });

  it('interprets a naive string as Pacific wall-clock (PST)', () => {
    expect(parsePacificWallClock('2026-01-15T15:00:00')).toBe(Date.parse('2026-01-15T15:00:00-08:00'));
  });

  it('passes through offset-qualified and Z strings unchanged', () => {
    expect(parsePacificWallClock('2026-05-21T10:00:00-07:00')).toBe(Date.parse('2026-05-21T10:00:00-07:00'));
    expect(parsePacificWallClock('2026-05-21T17:00:00Z')).toBe(Date.parse('2026-05-21T17:00:00Z'));
  });

  it('handles both sides of the spring-forward boundary', () => {
    expect(parsePacificWallClock('2026-03-08T01:59:00')).toBe(Date.parse('2026-03-08T01:59:00-08:00'));
    expect(parsePacificWallClock('2026-03-08T03:00:00')).toBe(Date.parse('2026-03-08T03:00:00-07:00'));
  });

  it('returns NaN for garbage', () => {
    expect(Number.isNaN(parsePacificWallClock('not-a-date'))).toBe(true);
    expect(Number.isNaN(parsePacificWallClock(''))).toBe(true);
  });
});

describe('normalizeGhlTimestamp', () => {
  it('stamps the correct Pacific offset onto naive strings', () => {
    expect(normalizeGhlTimestamp('2026-07-02T15:00:00')).toBe('2026-07-02T15:00:00-07:00');
    expect(normalizeGhlTimestamp('2026-01-15T15:00:00')).toBe('2026-01-15T15:00:00-08:00');
  });

  it('leaves already-qualified strings alone', () => {
    expect(normalizeGhlTimestamp('2026-05-21T10:00:00-07:00')).toBe('2026-05-21T10:00:00-07:00');
    expect(normalizeGhlTimestamp('2026-05-21T17:00:00Z')).toBe('2026-05-21T17:00:00Z');
  });

  it('returns unparseable values unchanged', () => {
    expect(normalizeGhlTimestamp('')).toBe('');
    expect(normalizeGhlTimestamp(undefined)).toBe(undefined);
  });
});
