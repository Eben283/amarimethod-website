import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/auth.js', () => ({ verifySessionToken: vi.fn(async () => ({ role: 'staff', user: 'Eben' })) }));
vi.mock('../lib/ghl.js', () => ({ ghlFetch: vi.fn() }));
import { ghlFetch } from '../lib/ghl.js';
import { onRequestGet } from './staff-owed.js';
import { SERIES_CALENDAR_IDS } from '../lib/session-ledger.js';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
let failure, records;
const context = () => ({ request: new Request('https://www.amarimethod.com/api/staff-owed?contactId=fixture', { headers: { Authorization: 'Bearer fixture' } }), env: { JWT_SECRET: 'fixture-only', STRIPE_SECRET_KEY: 'fixture-only', PURCHASE_KV: { get: async (key) => key.startsWith('payment:') ? records[key.split(':').at(-1)] || null : null, put: async () => {}, list: async () => ({ keys: Object.keys(records).map(id => ({ name: 'payment:fixture:' + id })), list_complete: true }) } } });
beforeEach(() => {
  failure = null; records = {};
  vi.mocked(ghlFetch).mockImplementation(async (_ctx, url) => {
    if (url.endsWith('/appointments')) return json(failure === 'appointments-shape' ? {} : { appointments: failure === 'appointments-empty' ? [] : failure === 'appointment-row' ? [{}] : [{ id: 'fixture_appt', calendarId: [...SERIES_CALENDAR_IDS][0], appointmentStatus: 'completed', startTime: failure === 'appointment-date' ? 'not-a-date' : '2026-01-01T12:00:00' }] }, failure === 'appointments' ? 500 : 200);
    if (url.endsWith('/contacts/fixture')) return json(failure === 'contact-shape' ? {} : { contact: { id: failure === 'contact-id' ? 'different' : 'fixture', firstName: 'Fixture', email: 'fixture@example.invalid' } }, failure === 'contact' ? 500 : 200);
    throw new Error('Unexpected provider call');
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/v1/charges/search' || path === '/v1/customers') return json({ data: [], has_more: false });
    throw new Error('Unexpected network call');
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe('Staff owed requires contact and attendance evidence', () => {
  it.each(['contact', 'appointments'])('returns unavailable after a failed %s read without claiming debt or payment', async (source) => {
    failure = source;
    const result = await onRequestGet(context());
    const body = await result.json();
    expect(result.status).toBe(200);
    expect(body.status).toBe('unavailable');
    expect(body.shortBy).toBeUndefined();
    expect(body.confidence).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves a complete unpaid-session result', async () => {
    const result = await onRequestGet(context());
    expect(await result.json()).toMatchObject({ status: 'owed', shortBy: 1 });
  });
});
it.each(['cash', 'venmo', 'check', 'other'])('honors recorded %s payment for the attended appointment', async (method) => {
  records.fixture_appt = { appointmentId: 'fixture_appt', contactId: 'fixture', status: 'paid', method };
  expect((await (await onRequestGet(context())).json()).status).toBe('square');
});
it('does not excuse attendance with payment for a different appointment', async () => {
  records.other = { appointmentId: 'other', status: 'paid', method: 'cash' };
  expect(await (await onRequestGet(context())).json()).toMatchObject({ status: 'owed', shortBy: 1 });
});
it.each(['stripe', null])('does not call a session unpaid when paid evidence with method %s is unresolved', async (method) => {
  records.fixture_appt = { appointmentId: 'fixture_appt', status: 'paid', method };
  const body = await (await onRequestGet(context())).json();
  expect(body.status).toBe('unavailable');
  expect(body.shortBy).toBeUndefined();
});
it('does not double-credit recorded Stripe payment when actual Stripe coverage is complete', async () => {
  records.fixture_appt = { appointmentId: 'fixture_appt', status: 'paid', method: 'stripe' };
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (new URL(url).pathname === '/v1/charges/search') return json({ data: [{ id: 'ch_fixture', amount: 19000, paid: true, status: 'succeeded', metadata: { contactId: 'fixture' } }], has_more: false });
    throw new Error('Unexpected network call');
  }));
  expect(await (await onRequestGet(context())).json()).toMatchObject({ status: 'square', sessionsPurchased: 1 });
});
it('leaves owed status unavailable after failed manual-payment evidence reads', async () => {
  const ctx = context(); ctx.env.PURCHASE_KV.list = async () => { throw new Error('Fixture read failed'); };
  expect((await (await onRequestGet(ctx)).json()).status).toBe('unavailable');
});
it('leaves owed status unavailable without manual-payment storage', async () => {
  const ctx = context(); delete ctx.env.PURCHASE_KV;
  expect((await (await onRequestGet(ctx)).json()).status).toBe('unavailable');
});

it.each(['contact-shape', 'contact-id', 'appointments-shape', 'appointment-row', 'appointment-date'])('does not interpret malformed HTTP200 %s as empty evidence', async (source) => {
  failure = source;
  const result = await onRequestGet(context());
  const body = await result.json();
  expect(result.status).toBe(200);
  expect(body.status).toBe('unavailable');
  expect(body.shortBy).toBeUndefined();
  expect(body.confidence).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});
it('accepts a verified empty attendance list', async () => {
  failure = 'appointments-empty';
  expect((await (await onRequestGet(context())).json()).status).toBe('square');
});
