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

let captured;

function setup({ apptStatus = 'confirmed', completed = '5', remaining = '3', kvStore = {} } = {}) {
  captured = { contactPut: null, apptPuts: [] };
  const contact = {
    id: 'c1',
    customFields: [
      { id: ID.completed, value: completed },
      { id: ID.remaining, value: remaining },
    ],
  };
  const appt = { id: 'a1', appointmentStatus: apptStatus, calendarId: 'SKDVOL8wtUN6Ne0ppbC9', startTime: '2026-06-09T18:00:00Z' };

  ghlFetch.mockImplementation(async (_ctx, url, opts) => {
    const method = opts?.method || 'GET';
    if (url.includes('/calendars/events/appointments/')) { captured.apptPuts.push(url); return resp({}); }
    if (url.includes('/appointments')) return resp({ appointments: [appt] });
    if (url.includes('/customFields')) return resp({ customFields: FIELD_DEFS });
    if (url.endsWith('/contacts/c1') && method === 'PUT') { captured.contactPut = JSON.parse(opts.body); return resp({}); }
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
    const ctx = setup();
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
});
