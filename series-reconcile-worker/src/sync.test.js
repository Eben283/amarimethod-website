import { describe, it, expect, vi, afterEach } from 'vitest';
import { guardDelta, clearNeedsReview, syncFieldsForContact } from './sync.js';

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

describe('syncFieldsForContact — guardrail short-circuits', () => {
  // KV hands back a still-valid token so getAccessToken skips the refresh path.
  function env() {
    return {
      PORTAL_KV: {
        get: async (k) =>
          k === 'ghl_access_token' ? 't'
            : k === 'ghl_token_expiry' ? String(Date.now() + 3_600_000)
            : null,
      },
    };
  }

  // Serve the four GHL reads syncFieldsForContact makes. Order matters: the
  // appointments URL also contains "/contacts/", so match it first.
  function stubGhl(contact, { orders = [], invoices = [], appointments = [] } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      let payload;
      if (u.includes('/appointments')) payload = { appointments };
      else if (u.includes('/payments/orders')) payload = { data: orders };
      else if (u.includes('/invoices/')) payload = { invoices };
      else if (u.includes('/contacts/')) payload = { contact };
      else payload = {};
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }));
  }

  afterEach(() => vi.unstubAllGlobals());

  it('skips a LOCKED contact before any write — protects Garrett-set manual balances (Albert Yang)', async () => {
    const contact = {
      firstName: 'Albert',
      lastName: 'Yang',
      customFields: [
        { id: 'oDyLqIeq3yTkyhgXhAmk', value: 'true' }, // sessions_remaining_locked
        { id: 'wrQSkx6BhXwDGIn1d0V4', value: '8' },     // sessions_remaining
        { id: 'TE0udwVH1Km5RsKaN5H0', value: '2' },     // sessions_completed
      ],
    };
    stubGhl(contact);
    const res = await syncFieldsForContact(env(), 'c1', {});
    expect(res.status).toBe('skipped-locked');
    expect(res.currentFields).toEqual({ sessions_remaining: 8, sessions_completed: 2 });
  });

  it('skips a contact edited within the 5-min debounce — a human may have just typed the value', async () => {
    const contact = {
      dateUpdated: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
      customFields: [], // not locked
    };
    stubGhl(contact);
    const res = await syncFieldsForContact(env(), 'c2', {});
    expect(res.status).toBe('skipped-recent-edit');
  });
});
