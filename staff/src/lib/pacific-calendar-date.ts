const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

function datePartsInPacific(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

export function pacificMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US-u-hc-h23', {
    timeZone: PACIFIC_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return value('hour') * 60 + value('minute');
}

export function makeCalendarDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 12));
}

export function pacificToday(now = new Date()): Date {
  const { year, month, day } = datePartsInPacific(now);
  return makeCalendarDate(year, month - 1, day);
}

export function calendarDateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function calendarDateLabel(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

export function addCalendarDays(date: Date, days: number): Date {
  return makeCalendarDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

export function addCalendarMonths(date: Date, months: number): Date {
  return makeCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

export function calendarWeekDates(date: Date): Date[] {
  const monday = addCalendarDays(date, -((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
}

export function calendarMonthDates(date: Date): Date[] {
  const first = makeCalendarDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const start = addCalendarDays(first, -((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
}

export function isPacificToday(date: Date, now = new Date()): boolean {
  return calendarDateKey(date) === calendarDateKey(pacificToday(now));
}

export function isCalendarDatePast(date: Date, now = new Date()): boolean {
  return calendarDateKey(date) < calendarDateKey(pacificToday(now));
}

export const calendarDateDay = (date: Date) => date.getUTCDate();
export const calendarDateMonth = (date: Date) => date.getUTCMonth();
