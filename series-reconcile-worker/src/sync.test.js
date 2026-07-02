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

  it('skips a low-confidence derivation — protects a real prepaid balance from being zeroed', async () => {
    // session_prepaid="yes" with NO orders → deriveLedger can't derive a count
    // (purchased=0) → ambiguity → confidence "low". The worker must NOT write a
    // derived 0 over the client's real prepaid balance (5 here).
    const contact = {
      customFields: [
        { id: 'sgQ5EbJWhvTfGVhStaOO', value: 'yes' }, // session_prepaid
        { id: 'wrQSkx6BhXwDGIn1d0V4', value: '5' },    // sessions_remaining — must survive
      ],
    };
    stubGhl(contact); // no orders / invoices / appointments
    const res = await syncFieldsForContact(env(), 'c3', {});
    expect(res.status).toBe('skipped-low-confidence');
  });
});

describe('syncFieldsForContact — 2026-07-02 P2 guards', () => {
  function env(portalStore = {}) {
    return {
      portalStore,
      PORTAL_KV: {
        get: async (k) =>
          k === 'ghl_access_token' ? 't'
            : k === 'ghl_token_expiry' ? String(Date.now() + 3_600_000)
            : (k in portalStore ? portalStore[k] : null),
        put: vi.fn(async (k, v) => { portalStore[k] = v; }),
        delete: vi.fn(async (k) => { delete portalStore[k]; }),
      },
    };
  }

  // Like stubGhl above, but tracks PUTs and can vary the contact per read.
  function stubGhl2({ contacts, orders = [], invoices = [], appointments = [] }) {
    let contactReads = 0;
    const puts = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const u = String(url);
      const method = opts?.method || 'GET';
      if (method === 'PUT') { puts.push({ url: u, body: opts.body }); return { ok: true, status: 200, text: async () => '{}' }; }
      let payload;
      if (u.includes('/appointments')) payload = { appointments };
      else if (u.includes('/payments/orders')) payload = { data: orders };
      else if (u.includes('/invoices/')) payload = { invoices };
      else if (u.includes('/contacts/')) {
        const c = contacts[Math.min(contactReads, contacts.length - 1)];
        contactReads++;
        payload = { contact: c };
      } else payload = {};
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }));
    return { puts };
  }

  afterEach(() => vi.unstubAllGlobals());

  const oldDate = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago — outside debounce

  it('OWED UNBURY: attended > purchased writes a needs-review entry instead of vanishing into the low-confidence skip', async () => {
    // 8-pack purchased, 9 attended — the math just detected owed money.
    // The old behavior skipped silently, so uncollected revenue never
    // reached /needs-review or the /day briefing (the known buried-owed
    // signal from reference-package-session-counting-rule).
    const contact = { firstName: 'Owey', lastName: 'Client', dateUpdated: oldDate, customFields: [{ id: 'wrQSkx6BhXwDGIn1d0V4', value: '0' }] };
    const appointments = Array.from({ length: 9 }, (_, i) => ({
      calendarId: 'SKDVOL8wtUN6Ne0ppbC9',
      appointmentStatus: 'showed',
      startTime: `2026-03-${String(2 + i).padStart(2, '0')}T10:00:00`,
    }));
    stubGhl2({
      contacts: [contact],
      orders: [{ status: 'completed', amount: 1295, sourceName: '8-Session Series', sourceType: 'payment_link', createdAt: '2026-03-01T18:00:00Z' }],
      appointments,
    });
    const e = env();
    const res = await syncFieldsForContact(e, 'c4', {});
    expect(res.status).toBe('skipped-low-confidence');
    const entry = e.portalStore['field-sync:needsReview:c4'];
    expect(entry).toBeTruthy();
    expect(JSON.parse(entry).reason).toMatch(/attended exceeds purchased/i);
  });

  it('CONCURRENT-EDIT GUARD: dateUpdated moving between derive and write skips the PUT (mark-attended clobber window)', async () => {
    const base = {
      firstName: 'Race', lastName: 'Case', dateUpdated: oldDate,
      customFields: [
        { id: 'wrQSkx6BhXwDGIn1d0V4', value: '4' }, // field says 4
        { id: 'TE0udwVH1Km5RsKaN5H0', value: '5' },
      ],
    };
    // Second contact read (the pre-write recheck) shows a NEW dateUpdated —
    // Garrett just marked attendance mid-derive.
    const edited = { ...base, dateUpdated: new Date().toISOString() };
    const { puts } = stubGhl2({
      contacts: [base, edited],
      orders: [{ status: 'completed', amount: 720, sourceName: '4-Session Series', sourceType: 'payment_link', createdAt: '2026-03-01T18:00:00Z' }],
      appointments: [{ calendarId: 'SKDVOL8wtUN6Ne0ppbC9', appointmentStatus: 'showed', startTime: '2026-03-02T10:00:00' }],
    });
    const res = await syncFieldsForContact(env(), 'c5', {});
    expect(res.status).toBe('skipped-concurrent-edit');
    expect(puts.length).toBe(0);
  });

  it('CONCURRENT-EDIT GUARD: unchanged dateUpdated still writes (synced)', async () => {
    const base = {
      firstName: 'Calm', lastName: 'Case', dateUpdated: oldDate,
      customFields: [
        { id: 'wrQSkx6BhXwDGIn1d0V4', value: '4' },
        { id: 'TE0udwVH1Km5RsKaN5H0', value: '5' },
      ],
    };
    const { puts } = stubGhl2({
      contacts: [base, base],
      orders: [{ status: 'completed', amount: 720, sourceName: '4-Session Series', sourceType: 'payment_link', createdAt: '2026-03-01T18:00:00Z' }],
      appointments: [{ calendarId: 'SKDVOL8wtUN6Ne0ppbC9', appointmentStatus: 'showed', startTime: '2026-03-02T10:00:00' }],
    });
    const res = await syncFieldsForContact(env(), 'c6', {});
    expect(res.status).toBe('synced');
    expect(puts.length).toBe(1);
  });

  it('PAGE-FULL GUARD: exactly 100 orders returned drops confidence instead of deriving from truncated history', async () => {
    // GHL auto-creates a placeholder order per booking; past 100 records the
    // oldest (the real package purchase) silently falls off the page and
    // purchased undercounts. A full page must not be trusted as complete.
    const contact = { firstName: 'Busy', lastName: 'Client', dateUpdated: oldDate, customFields: [{ id: 'wrQSkx6BhXwDGIn1d0V4', value: '3' }] };
    const orders = Array.from({ length: 100 }, () => ({
      status: 'completed', amount: 190, sourceName: 'Follow-up Session', sourceType: 'calendar', createdAt: '2026-05-01T18:00:00Z',
    }));
    stubGhl2({ contacts: [contact], orders });
    const res = await syncFieldsForContact(env(), 'c7', {});
    expect(res.status).toBe('skipped-low-confidence');
    expect(JSON.stringify(res.ledger.ambiguities)).toMatch(/page full|truncated/i);
  });
});
