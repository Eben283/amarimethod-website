import { describe, it, expect } from 'vitest';
import { SETTLED_CONTACT_IDS, isSettled, settledReason } from './owed-settled.js';

describe('owed-settled overrides', () => {
  it('flags pinned contacts as settled', () => {
    expect(isSettled('zjewEnCWTi7Q7aY8hHYD')).toBe(true); // Igor Khizver
    expect(isSettled('umT57oFIilMRwanGhf84')).toBe(true); // Tae-woo Kim
  });

  it('does not flag an unlisted contact', () => {
    expect(isSettled('not-a-real-id')).toBe(false);
    expect(isSettled('')).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });

  it('returns the recorded reason, or null when unlisted', () => {
    expect(settledReason('hwkgCO2p9DniemD0CoeC')).toMatch(/off-platform/i); // Sean Riordan
    expect(settledReason('not-a-real-id')).toBeNull();
  });

  it('pins exactly the 7 verified clients', () => {
    expect(SETTLED_CONTACT_IDS.size).toBe(7);
  });

  it('every entry has a non-empty reason', () => {
    for (const reason of SETTLED_CONTACT_IDS.values()) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
