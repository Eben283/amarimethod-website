import { describe, it, expect } from 'vitest';
import { isAlreadyProcessed } from './staff-mark-attended.js';

describe('isAlreadyProcessed (mark-attended idempotency)', () => {
  it('not marked yet → process', () => {
    expect(isAlreadyProcessed('confirmed', true, false)).toBe(false);
    expect(isAlreadyProcessed(null, true, false)).toBe(false);
  });

  it('marked + no count change needed (e.g. discovery call) → done', () => {
    expect(isAlreadyProcessed('showed', false, false)).toBe(true);
    expect(isAlreadyProcessed('completed', false, false)).toBe(true);
  });

  it('marked + count needed + already debited → done (no double-count)', () => {
    expect(isAlreadyProcessed('showed', true, true)).toBe(true);
  });

  // THE FIX: appt marked "showed" but the count was never applied (partial
  // failure) must RE-PROCESS, not skip — otherwise the session is never debited.
  it('marked but NOT debited → re-process (the stuck-state fix)', () => {
    expect(isAlreadyProcessed('showed', true, false)).toBe(false);
    expect(isAlreadyProcessed('completed', true, false)).toBe(false);
  });
});
