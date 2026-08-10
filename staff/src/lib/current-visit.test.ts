import { describe, expect, it } from 'vitest';
import { canMarkCurrentVisit, selectCurrentVisit } from './current-visit';

const now = new Date('2026-08-09T18:00:00.000Z').getTime();
const visit = (id: string, startTime: string, status = 'confirmed') => ({
  id, startTime, endTime: startTime, status,
});

describe('current visit selection', () => {
  it('does not call an old unselected appointment current', () => {
    expect(selectCurrentVisit([
      visit('old', '2026-08-04T18:00:00.000Z'),
    ], null, now)).toBeNull();
  });

  it('prefers the next appointment when no visit was explicitly selected', () => {
    expect(selectCurrentVisit([
      visit('recent', '2026-08-09T12:00:00.000Z'),
      visit('next', '2026-08-11T18:00:00.000Z'),
    ], null, now)?.id).toBe('next');
  });

  it('keeps an explicitly selected historical visit inspectable', () => {
    const old = visit('old', '2026-08-04T18:00:00.000Z');
    expect(selectCurrentVisit([old], 'old', now)?.id).toBe('old');
    expect(canMarkCurrentVisit(old, true, now)).toBe(true);
  });

  it('never offers attendance for completed or cancelled visits', () => {
    expect(canMarkCurrentVisit(visit('done', '2026-08-09T17:00:00.000Z', 'completed'), true, now)).toBe(false);
    expect(canMarkCurrentVisit(visit('cancelled', '2026-08-09T17:00:00.000Z', 'cancelled'), true, now)).toBe(false);
  });
});
