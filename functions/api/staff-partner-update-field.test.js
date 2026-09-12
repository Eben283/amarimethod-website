import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/endpoint-guards.js', () => ({
  requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: 'Eben' } })),
  corsHeaders: vi.fn(() => ({ 'Access-Control-Allow-Origin': 'https://www.amarimethod.com' })),
}));
vi.mock('../lib/ghl.js', () => ({
  getGhlToken: vi.fn(async () => 'synthetic-token'),
  ghlHeaders: vi.fn(() => ({})),
}));

import { onRequestPost } from './staff-partner-update-field.js';

let fetchMock;
const context = (value = '') => ({
  request: new Request('https://www.amarimethod.com/api/staff-partner-update-field', {
    method: 'POST',
    headers: { Origin: 'https://www.amarimethod.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId: 'synthetic-contact', field: 'partnerFacility', value }),
  }),
  env: {},
});

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Outreach inline field prerequisite reads', () => {
  it.each([
    ['provider rejection', () => new Response('{"error":"unavailable"}', { status: 503 })],
    ['network failure', () => Promise.reject(new Error('connect timeout'))],
    ['malformed success response', () => new Response('{}')],
  ])('fails closed on %s instead of treating an unverified clear as a no-op', async (_label, currentRead) => {
    fetchMock.mockImplementationOnce(currentRead);

    const response = await onRequestPost(context(''));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/current field value could not be verified/i),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a verified unchanged value idempotent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ contact: { customFields: [] } })));

    const response = await onRequestPost(context(''));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: false, value: '' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('updates a changed value only after reading the current value', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ contact: { customFields: [] } })))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}'));

    const response = await onRequestPost(context('New facility'));

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      customFields: [{ id: 'eYBj61zgMnIFMIesoDR5', value: 'New facility' }],
    });
  });
});
