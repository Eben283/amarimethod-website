import { describe, it, expect } from 'vitest';
import { guardDelta, clearNeedsReview } from './sync.js';

// MAX_AUTO_DELTA is 2 in sync.js — deltas > 2 are held for human review.
describe('guardDelta (#4 — never-written field is a fill, not a drift)', () => {
  // THE #4 BUG: a blank field used to coerce to 0, so a fresh 8-pack whose
  // sessions_remaining was never written read as "0 vs 8" = delta 8 > 2 →
  // parked in needs-review forever instead of just being filled with 8.
  it('returns 0 for a never-written (null/undefined) current value — so it is auto-filled, not flagged', () => {
    expect(guardDelta(null, 8)).toBe(0);
    expect(guardDelta(undefined, 8)).toBe(0);
    expect(guardDelta(null, 4)).toBe(0);
    expect(guardDelta(null, 0)).toBe(0);
  });

  it('returns the true |derived - current| for a WRITTEN value (incl. a real 0)', () => {
    expect(guardDelta(0, 8)).toBe(8);   // explicit 0 is a real disagreement, NOT a fill
    expect(guardDelta(6, 5)).toBe(1);
    expect(guardDelta(5, 8)).toBe(3);
    expect(guardDelta(8, 8)).toBe(0);
  });

  it('a small drift on a written value stays under the review threshold (≤2 → auto-applied)', () => {
    expect(guardDelta(6, 5)).toBeLessThanOrEqual(2); // would auto-write
    expect(guardDelta(4, 5)).toBeLessThanOrEqual(2);
  });

  it('a large drift on a written value exceeds the threshold (>2 → human review)', () => {
    expect(guardDelta(8, 2)).toBeGreaterThan(2); // a real human-set value far from derived stays protected
    expect(guardDelta(1, 8)).toBeGreaterThan(2);
  });
});

describe('clearNeedsReview (stale-flag cleanup)', () => {
  it('deletes the contact-prefixed needs-review key so a resolved drift stops nagging', async () => {
    const deleted = [];
    const env = { PORTAL_KV: { delete: async (k) => { deleted.push(k); } } };
    await clearNeedsReview(env, 'C123');
    expect(deleted).toEqual(['field-sync:needsReview:C123']);
  });

  it('is best-effort — a KV delete failure does not throw out of the sync flow', async () => {
    const env = { PORTAL_KV: { delete: async () => { throw new Error('kv down'); } } };
    await expect(clearNeedsReview(env, 'C123')).resolves.toBeUndefined();
  });
});
