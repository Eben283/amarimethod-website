// Integration tests for staff-mark-attended's WRITE orchestration.
// isAlreadyProcessed (the idempotency decision) is unit-tested in
// staff-mark-attended.test.js. This exercises onRequestPost: does marking a
// session actually write the right +1 lifetime / −1 package mutation, does a
// non-session (discovery) skip the count, and does idempotency block a re-apply?

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ghl.js', () => ({ ghlFetch: vi.fn() }));
vi.mock('../lib/auth.js', () => ({ verifySessionToken: vi.fn(async () => ({ role: 'staff', email: 'garrett@x.com' })) }));
vi.mock('../lib/session-payment.js', () => ({
  resolveSessionPayment: vi.fn(() => null), // skip the non-blocking payment-capture branch
  buildPaymentRecord: vi.fn(),
  writePaymentRecord: vi.fn(),
}));

import { onRequestPost } from './staff-mark-attended.js';
import { verifySessionToken } from '../lib/auth.js';
import { ghlFetch } from '../lib/ghl.js';

const ID = {
  completed: 'TE0udwVH1Km5RsKaN5H0',
  remaining: 'wrQSkx6BhXwDGIn1d0V4',
  prepaid: 'sgQ5EbJWhvTfGVhStaOO',
};

const FIELD_DEFS = [
  { fieldKey: 'contact.sessions_completed', id: ID.completed },
  { fieldKey: 'contact.sessions_remaining', id: ID.remaining },
  { fieldKey: 'contact.session_prepaid', id: ID.prepaid },
];

const resp = (obj, ok = true, status = 200) => ({ ok, status, json: async () => obj, text: async () => JSON.stringify(obj) });

// In-memory fake of the ATTEND_DB (D1) binding — models the atomic
// INSERT ... ON CONFLICT DO NOTHING claim. `seed` pre-claims appointments (to
// simulate a concurrent request that already won the claim).
function makeFakeD1(seed = []) {
  const rows = new Map(seed.map((id) => [id, { appointment_id: id }]));
  return {
    rows,
    prepare(sql) {
      return {
        _sql: sql, _args: [],
        bind(...args) { this._args = args; return this; },
        async run() {
          if (/^INSERT INTO attended_debits/.test(this._sql)) {
            const id = this._args[0];
            if (rows.has(id)) return { meta: { changes: 0 } };
            rows.set(id, { appointment_id: id, contact_id: this._args[1] });
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM attended_debits/.test(this._sql)) return { meta: { changes: rows.delete(this._args[0]) ? 1 : 0 } };
          if (/^UPDATE attended_debits/.test(this._sql)) { const r = rows.get(this._args[3]); if (r) Object.assign(r, { applied_at: this._args[0], completed: this._args[1], remaining: this._args[2] }); return { meta: { changes: r ? 1 : 0 } }; }
          return { meta: { changes: 0 } };
        },
        async first() { return (/^SELECT 1 FROM attended_debits/.test(this._sql) && rows.has(this._args[0])) ? { 1: 1 } : null; },
      };
    },
  };
}

let captured;

function setup({ apptStatus = 'confirmed', completed = '5', remaining = '3', kvStore = {}, attendDb = null, contactPutFails = false, calendarId = 'SKDVOL8wtUN6Ne0ppbC9' } = {}) {
  captured = { contactPut: null, apptPuts: [] };
  const contact = {
    id: 'c1',
    customFields: [
      { id: ID.completed, value: completed },
      { id: ID.remaining, value: remaining },
    ],
  };
  const appt = { id: 'a1', appointmentStatus: apptStatus, calendarId, startTime: '2026-06-09T18:00:00Z' };

  ghlFetch.mockImplementation(async (_ctx, url, opts) => {
    const method = opts?.method || 'GET';
    if (url.includes('/calendars/events/appointments/')) { captured.apptPuts.push(url); return resp({}); }
    if (url.includes('/appointments')) return resp({ appointments: [appt] });
    if (url.includes('/customFields')) return resp({ customFields: FIELD_DEFS });
    if (url.endsWith('/contacts/c1') && method === 'PUT') { captured.contactPut = JSON.parse(opts.body); return contactPutFails ? resp({ error: 'boom' }, false, 422) : resp({}); }
    if (url.endsWith('/contacts/c1')) return resp({ contact }); // GET
    return resp({});
  });

  const env = {
    JWT_SECRET: 'jwt',
    PURCHASE_KV: {
      get: vi.fn(async (k) => (k in kvStore ? kvStore[k] : null)),
      put: vi.fn(async (k, v) => { kvStore[k] = v; }),
    },
  };
  if (attendDb) env.ATTEND_DB = attendDb;
  return { env, request: makeReq() };
}

function makeReq(body = { appointmentId: 'a1', contactId: 'c1', appointmentTitle: 'Follow-up Session', calendarName: 'Follow-up Session — In Person' }) {
  return {
    json: async () => body,
    headers: { get: (h) => (h === 'Authorization' ? 'Bearer t' : h === 'Origin' ? 'https://www.amarimethod.com' : null) },
  };
}

const field = (cf, id) => cf.customFields.find((f) => f.id === id)?.field_value;

beforeEach(() => vi.clearAllMocks());

describe('staff-mark-attended — write orchestration', () => {
  it('follow-up session → +1 sessions_completed, −1 sessions_remaining, sets debit flag', async () => {
    const ctx = setup({ completed: '5', remaining: '3' });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(captured.contactPut).toBeTruthy();
    expect(field(captured.contactPut, ID.completed)).toBe('6'); // 5 + 1 lifetime
    expect(field(captured.contactPut, ID.remaining)).toBe('2'); // 3 − 1 package draw
    expect(ctx.env.PURCHASE_KV.put).toHaveBeenCalledWith(
      'attended-debited:a1', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it('drawing the last session to 0 also clears session_prepaid', async () => {
    const ctx = setup({ completed: '7', remaining: '1' });
    await onRequestPost(ctx);
    expect(field(captured.contactPut, ID.remaining)).toBe('0');
    expect(field(captured.contactPut, ID.prepaid)).toBe('no');
  });

  it('discovery call → marks showed but does NOT touch the counts (no contact PUT)', async () => {
    // calendarId-first classification (2026-07-02): the fixture appointment
    // must actually live on the discovery calendar, matching reality.
    const ctx = setup({ calendarId: 'USgPsktqRcuomdUgpShL' });
    ctx.request = makeReq({ appointmentId: 'a1', contactId: 'c1', appointmentTitle: 'Discovery Call', calendarName: 'Discovery Call' });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(captured.contactPut).toBeNull(); // no count mutation
    expect(captured.apptPuts.length).toBeGreaterThan(0); // but still marked showed
  });

  it('idempotent: already showed AND already debited → no writes at all', async () => {
    const ctx = setup({ apptStatus: 'showed', kvStore: { 'attended-debited:a1': '{}' } });
    const res = await onRequestPost(ctx);
    const json = JSON.parse(await res.text());
    expect(json.alreadyAttended).toBe(true);
    expect(captured.contactPut).toBeNull();
    expect(captured.apptPuts.length).toBe(0);
  });

  it('non-staff token → 403, no writes', async () => {
    verifySessionToken.mockResolvedValueOnce({ role: 'client' });
    const ctx = setup();
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(403);
    expect(captured.contactPut).toBeNull();
  });

  // ── D1 atomic-claim path (ATTEND_DB bound) ──
  it('D1 path: marks + decrements, finalizes the claim row, and does NOT write the KV flag', async () => {
    const db = makeFakeD1();
    const ctx = setup({ completed: '5', remaining: '3', attendDb: db });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(field(captured.contactPut, ID.remaining)).toBe('2'); // 3 − 1
    expect(db.rows.get('a1').remaining).toBe(2);                 // claim row finalized
    expect(ctx.env.PURCHASE_KV.put).not.toHaveBeenCalled();      // KV flag bypassed when D1 is bound
  });

  it('D1 path: a concurrent loser (claim already held) returns alreadyAttended without decrementing', async () => {
    // appt still "confirmed" but the claim row already exists → the early read lets it
    // proceed to the atomic claim, which loses → must NOT touch the count.
    const db = makeFakeD1(['a1']);
    const ctx = setup({ apptStatus: 'confirmed', attendDb: db });
    const res = await onRequestPost(ctx);
    const json = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(json.alreadyAttended).toBe(true);
    expect(json.sessionCountUpdated).toBe(false);
    expect(captured.contactPut).toBeNull(); // the loser never decremented
  });

  it('D1 path: a failed contact PUT releases the claim so a retry can re-apply', async () => {
    const db = makeFakeD1();
    const ctx = setup({ attendDb: db, contactPutFails: true });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(422);
    expect(db.rows.has('a1')).toBe(false); // claim released — not permanently stuck
  });
});

// ── 2026-07-02 audit guards ─────────────────────────────────────────────────

describe('staff-mark-attended — audit guards (2026-07-02)', () => {
  it('entrainment with remaining=0 does NOT clear session_prepaid (manual override survives)', async () => {
    // Client has 0 package sessions left but prepaid an individual session for
    // next visit (session_prepaid=yes, set manually). Marking an ENTRAINMENT
    // attended (lifetime-only, no package draw) must not wipe that override —
    // the old `newRemaining === 0` condition did, flipping the Today-view pill
    // to "Unpaid" for a session the client already paid for.
    const ctx = setup({ completed: '5', remaining: '0', calendarId: 'B5aGXLoS4kzAjZAMMXxk' });
    ctx.request = makeReq({
      appointmentId: 'a1',
      contactId: 'c1',
      appointmentTitle: 'Entrainment',
      calendarName: 'Entrainment',
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(captured.contactPut).toBeTruthy(); // lifetime +1 still writes
    expect(field(captured.contactPut, ID.completed)).toBe('6');
    expect(field(captured.contactPut, ID.remaining)).toBeUndefined(); // no draw
    expect(field(captured.contactPut, ID.prepaid)).toBeUndefined(); // override untouched
  });

  it('KV fallback: an existing debit flag blocks a second decrement even when the appt reads unmarked', async () => {
    // No D1 bound. The debit flag says the count was already applied, but the
    // appointment reads "confirmed" (status reverted in GHL UI, or a stale
    // list). Re-marking is fine; re-decrementing burns a prepaid session.
    const kvStore = { 'attended-debited:a1': JSON.stringify({ at: '2026-07-01T00:00:00Z' }) };
    const ctx = setup({ apptStatus: 'confirmed', kvStore });
    const res = await onRequestPost(ctx);
    const json = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(json.sessionCountUpdated).toBe(false);
    expect(captured.apptPuts.length).toBe(1); // still marked showed
    expect(captured.contactPut).toBeNull(); // but the count was NOT re-applied
  });

  it('a failed appointment-list fetch is a hard 422, not a blind proceed', async () => {
    // With the list unavailable the endpoint can't evaluate idempotency —
    // proceeding used to re-mark AND re-decrement on retry after a GHL blip.
    const ctx = setup();
    const base = ghlFetch.getMockImplementation();
    ghlFetch.mockImplementation(async (c, url, opts) => {
      if (url.includes('/calendars/events/appointments/')) return base(c, url, opts);
      if (url.includes('/appointments')) return resp({ error: 'rate limited' }, false, 429);
      return base(c, url, opts);
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(422);
    expect(captured.apptPuts.length).toBe(0); // nothing written
    expect(captured.contactPut).toBeNull();
  });
});

describe('staff-mark-attended — calendarId-based classification (2026-07-02 P2)', () => {
  it('classifies from the appointment calendarId even when the body carries no title/calendar', async () => {
    // The appointment is on the ENTRAINMENT calendar, but the caller sent
    // empty strings. String-based classification treated '' as counts+draws
    // and decremented the package for a $90 individually-billed entrainment.
    const ctx = setup({ completed: '5', remaining: '3' });
    // Re-mock: same appointment but on the entrainment calendar.
    ghlFetch.mockImplementation(async (_c, url, opts) => {
      const method = opts?.method || 'GET';
      if (url.includes('/calendars/events/appointments/')) { captured.apptPuts.push(url); return resp({}); }
      if (url.includes('/appointments')) return resp({ appointments: [{ id: 'a1', appointmentStatus: 'confirmed', calendarId: 'B5aGXLoS4kzAjZAMMXxk', startTime: '2026-06-09T18:00:00Z' }] });
      if (url.includes('/customFields')) return resp({ customFields: FIELD_DEFS });
      if (url.endsWith('/contacts/c1') && method === 'PUT') { captured.contactPut = JSON.parse(opts.body); return resp({}); }
      if (url.endsWith('/contacts/c1')) return resp({ contact: { id: 'c1', customFields: [{ id: ID.completed, value: '5' }, { id: ID.remaining, value: '3' }] } });
      return resp({});
    });
    ctx.request = makeReq({ appointmentId: 'a1', contactId: 'c1' }); // no title, no calendarName
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(field(captured.contactPut, ID.completed)).toBe('6'); // entrainment counts lifetime
    expect(field(captured.contactPut, ID.remaining)).toBeUndefined(); // but never draws the package
  });

  it('discovery-calendar appointment counts neither field regardless of body strings', async () => {
    const ctx = setup();
    ghlFetch.mockImplementation(async (_c, url, opts) => {
      const method = opts?.method || 'GET';
      if (url.includes('/calendars/events/appointments/')) { captured.apptPuts.push(url); return resp({}); }
      if (url.includes('/appointments')) return resp({ appointments: [{ id: 'a1', appointmentStatus: 'confirmed', calendarId: 'USgPsktqRcuomdUgpShL', startTime: '2026-06-09T18:00:00Z' }] });
      if (url.includes('/customFields')) return resp({ customFields: FIELD_DEFS });
      if (url.endsWith('/contacts/c1') && method === 'PUT') { captured.contactPut = JSON.parse(opts.body); return resp({}); }
      if (url.endsWith('/contacts/c1')) return resp({ contact: { id: 'c1', customFields: [] } });
      return resp({});
    });
    ctx.request = makeReq({ appointmentId: 'a1', contactId: 'c1', appointmentTitle: 'Follow-up Session', calendarName: '' });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(captured.apptPuts.length).toBe(1); // marked showed
    expect(captured.contactPut).toBeNull();   // no counts touched
  });
});
