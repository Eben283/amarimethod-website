import { describe, it, expect } from 'vitest';
import { remainingIndicatesUndercredit } from './rules.js';

// Regression for the false-CRITICAL "sessions_remaining_not_incremented" alarm
// (session-audit 2026-06-06b). The audit reads a snapshot N hours after the
// purchase, so a legitimately drawn-down balance must NOT be reported as a
// failed credit — only a genuine under-credit should.
describe('remainingIndicatesUndercredit', () => {
  // Garrett's standard protocol: run session → sell 8-pack (SET to 8) → mark the
  // just-run session showed → 8 becomes 7. This must be silent.
  it('does NOT flag an 8-pack that dropped to 7 from a same-day draw', () => {
    expect(remainingIndicatesUndercredit('7', 8)).toBe(false);
  });
  it('does NOT flag an 8-pack at 6 (two same-window draws)', () => {
    expect(remainingIndicatesUndercredit('6', 8)).toBe(false);
  });
  // à-la-carte single: ADD +1, then attended same day → back to 0.
  it('does NOT flag a single follow-up bought and attended to 0', () => {
    expect(remainingIndicatesUndercredit('0', 1)).toBe(false);
  });
  it('does NOT flag a full, untouched package', () => {
    expect(remainingIndicatesUndercredit('8', 8)).toBe(false);
  });

  // Genuine under-credit (the SET never fired) still fires.
  it('FLAGS an 8-pack stuck near zero', () => {
    expect(remainingIndicatesUndercredit('0', 8)).toBe(true);
    expect(remainingIndicatesUndercredit('1', 8)).toBe(true);
  });
  it('FLAGS a missing / unparseable field after a recognized purchase', () => {
    expect(remainingIndicatesUndercredit('', 8)).toBe(true);
    expect(remainingIndicatesUndercredit(undefined, 8)).toBe(true);
  });
});
