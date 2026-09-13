import { describe, expect, it } from 'vitest';
import {
  calendarDateKey,
  calendarDateLabel,
  calendarMonthDates,
  calendarWeekDates,
  makeCalendarDate,
  pacificMinutesOfDay,
  pacificToday,
} from '../../staff/src/lib/pacific-calendar-date';

describe('Staff Pacific calendar dates', () => {
  it('derives today from Pacific time even when UTC is already the next day', () => {
    const date = pacificToday(new Date('2026-09-11T06:30:00.000Z'));
    expect(calendarDateKey(date)).toBe('2026-09-10');
    expect(calendarDateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' }))
      .toBe('Thursday, September 10');
  });

  it('keeps month cells, labels, and request keys on the same civil day', () => {
    const september = makeCalendarDate(2026, 8, 11);
    const dates = calendarMonthDates(september);
    const september10 = dates.find((date) => calendarDateKey(date) === '2026-09-10');
    expect(september10).toBeDefined();
    expect(calendarDateLabel(september10!, { weekday: 'long', month: 'long', day: 'numeric' }))
      .toBe('Thursday, September 10');
  });

  it('builds a Monday-through-Sunday week without browser-local date math', () => {
    expect(calendarWeekDates(makeCalendarDate(2026, 8, 11)).map(calendarDateKey)).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ]);
  });

  it('positions appointments by Pacific wall-clock time', () => {
    expect(pacificMinutesOfDay(new Date('2026-09-10T17:30:00.000Z'))).toBe(10 * 60 + 30);
  });
});
