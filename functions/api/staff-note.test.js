import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/endpoint-guards.js', () => ({
  corsHeaders: vi.fn(() => ({ 'Access-Control-Allow-Origin': 'https://www.amarimethod.com' })),
  requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: 'Eben' } })),
}));

import { requireStaffAuth } from '../lib/endpoint-guards.js';
import {
  RETIRED_STAFF_NOTE,
  onRequestPost,
  onRequestPut,
  retiredStaffNoteResponse,
} from './staff-note.js';

const authenticatedContext = () => ({
  request: new Request('https://www.amarimethod.com/api/staff-note', {
    method: 'POST',
    headers: { Origin: 'https://www.amarimethod.com' },
  }),
});

describe('retired legacy Staff note path', () => {
  beforeEach(() => {
    vi.mocked(requireStaffAuth).mockReset();
    vi.mocked(requireStaffAuth).mockResolvedValue({ error: null, payload: { user: 'Eben' } });
  });

  it('fails closed and points authenticated callers to the owned Client Desk', async () => {
    const response = retiredStaffNoteResponse({ 'Content-Type': 'application/json' });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual(RETIRED_STAFF_NOTE);
    expect(RETIRED_STAFF_NOTE.destination).toBe('/staff/client-desk');
  });

  it.each([
    ['POST', onRequestPost],
    ['PUT', onRequestPut],
  ])('returns the retired response after authenticating %s requests', async (_method, handler) => {
    const response = await handler(authenticatedContext());
    expect(requireStaffAuth).toHaveBeenCalledOnce();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual(RETIRED_STAFF_NOTE);
  });

  it('preserves the Staff authentication boundary', async () => {
    const unauthorized = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(requireStaffAuth).mockResolvedValueOnce({ error: unauthorized, payload: null });
    const response = await onRequestPost(authenticatedContext());
    expect(response).toBe(unauthorized);
  });

  it('contains no GHL or provider-note write adapter', () => {
    const source = readFileSync(new URL('./staff-note.js', import.meta.url), 'utf8');
    expect(source).not.toContain('ghlFetch');
    expect(source).not.toContain('services.leadconnectorhq.com');
    expect(source).not.toMatch(/contacts\/.+\/notes/);
  });
});
