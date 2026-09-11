import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/auth.js', () => ({ verifySessionToken: vi.fn(async () => ({ role: 'staff', user: 'Eben' })) }));
vi.mock('../lib/ghl.js', () => ({ ghlFetch: vi.fn() }));
import { ghlFetch } from '../lib/ghl.js';
import { onRequestGet } from './staff-owed-list.js';
const context = () => ({ request: new Request('https://www.amarimethod.com/api/staff-owed-list', { headers: { Authorization: 'Bearer fixture' } }), env: { JWT_SECRET: 'fixture-only' } });
describe('owed roster requires every calendar read', () => {
  it.each([['provider failure', 500, { error: 'Synthetic failure' }], ['malformed successful body', 200, {}]])('never presents %s as an empty roster', async (_label, status, payload) => {
    vi.mocked(ghlFetch).mockImplementation(async () => new Response(JSON.stringify(payload), { status }));
    const result = await onRequestGet(context());
    expect(result.status).toBe(500);
    expect((await result.json()).roster).toBeUndefined();
  });
  it('accepts genuinely empty calendars', async () => {
    vi.mocked(ghlFetch).mockImplementation(async () => new Response(JSON.stringify({ events: [] }), { status: 200 }));
    const result = await onRequestGet(context());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ roster: [], rosterSize: 0 });
  });
});
