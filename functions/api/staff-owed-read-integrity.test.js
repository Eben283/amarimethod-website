import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/auth.js', () => ({ verifySessionToken: vi.fn(async () => ({ role: 'staff', user: 'Eben' })) }));
vi.mock('../lib/ghl.js', () => ({ ghlFetch: vi.fn() }));
import { ghlFetch } from '../lib/ghl.js';
import { onRequestGet } from './staff-owed.js';
import { SERIES_CALENDAR_IDS } from '../lib/session-ledger.js';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
let failure;
const context = () => ({ request: new Request('https://www.amarimethod.com/api/staff-owed?contactId=fixture', { headers: { Authorization: 'Bearer fixture' } }), env: { JWT_SECRET: 'fixture-only', STRIPE_SECRET_KEY: 'fixture-only', PURCHASE_KV: { get: async () => null, put: async () => {}, list: async () => ({ keys: [], list_complete: true }) } } });
beforeEach(() => {
  failure = null;
  vi.mocked(ghlFetch).mockImplementation(async (_ctx, url) => {
    if (url.endsWith('/appointments')) return json({ appointments: [{ id: 'fixture_appt', calendarId: [...SERIES_CALENDAR_IDS][0], appointmentStatus: 'completed', startTime: '2026-01-01T12:00:00' }] }, failure === 'appointments' ? 500 : 200);
    if (url.endsWith('/contacts/fixture')) return json({ contact: { id: 'fixture', firstName: 'Fixture', email: 'fixture@example.invalid' } }, failure === 'contact' ? 500 : 200);
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
