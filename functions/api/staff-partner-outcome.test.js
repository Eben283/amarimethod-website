import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/endpoint-guards.js', () => ({
  requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: 'Eben' } })),
  corsHeaders: vi.fn(() => ({ 'Access-Control-Allow-Origin': 'https://www.amarimethod.com' })),
}));
vi.mock('../lib/ghl.js', () => ({ getGhlToken: vi.fn(async () => 'synthetic-token'), ghlHeaders: () => ({}) }));
import { requireStaffAuth } from '../lib/endpoint-guards.js';
import { getGhlToken } from '../lib/ghl.js';
import { RETIRED_STAFF_NOTE } from './staff-note.js';
import { onRequestPost } from './staff-partner-outcome.js';

let fetchMock;
const context = (body) => ({
  request: new Request('https://www.amarimethod.com/api/staff-partner-outcome', {
    method: 'POST', headers: { Origin: 'https://www.amarimethod.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  env: { PORTAL_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn(async () => {}) } },
});
function untouched(ctx) {
  expect(getGhlToken).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  for (const method of Object.values(ctx.env.PORTAL_KV)) expect(method).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireStaffAuth).mockResolvedValue({ error: null, payload: { user: 'Eben' } });
  fetchMock = vi.fn();vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('retired Outreach standalone note action', () => {
  it.each([undefined, '', '   ', 'An ordinary note', { unexpected: 'body' }])('fails closed before any credential/provider/cache access for note body %j', async (note) => {
    const ctx = context({ contactId: 'synthetic-contact', signal: 'note', note, followupAt: '2099-01-01', stage: 'working' });
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual(RETIRED_STAFF_NOTE);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    untouched(ctx);
  });
  it('keeps Staff authentication ahead of retirement and body parsing', async () => {
    const denied = new Response('{}', { status: 401 });
    vi.mocked(requireStaffAuth).mockResolvedValueOnce({ error: denied });
    const ctx = context({ signal: 'note' });
    ctx.request = { headers: new Headers(), json: vi.fn(() => { throw new Error('must not parse'); }) };
    expect(await onRequestPost(ctx)).toBe(denied);
    expect(ctx.request.json).not.toHaveBeenCalled();untouched(ctx);
  });
  it('rejects malformed JSON before provider access', async () => {
    const ctx = context({});
    ctx.request = new Request('https://www.amarimethod.com/api/staff-partner-outcome', { method: 'POST', body: '{' });
    expect((await onRequestPost(ctx)).status).toBe(400);untouched(ctx);
  });
  it.each([null, {}, { contactId: '', signal: 'note' }, { contactId: 1, signal: 'note' }, { contactId: 'synthetic-contact', signal: 'unknown' }, { contactId: 'synthetic-contact', signal: 'deferred' }])('preserves invalid request validation %j', async (body) => {
    const ctx = context(body);
    expect((await onRequestPost(ctx)).status).toBe(400);untouched(ctx);
  });
  it.each([
    ['no-answer', 'Outcome: No answer', 'working'], ['voicemail', 'Outcome: Voicemail', 'working'],
    ['talked', 'Outcome: Talked', 'working'], ['link-sent', 'Outcome: Sent link', 'working'],
    ['texted', 'Outcome: Texted', 'working'], ['emailed', 'Outcome: Emailed', 'working'],
    ['booked', 'Outcome: Booked', 'session-booked'], ['deferred', 'Outcome: Future potential', 'future-potential'],
    ['not-interested', 'Outcome: Not interested', 'dropped'], ['linkedin-msg', 'Touch: LinkedIn message', 'working'],
    ['linkedin-req', 'Touch: LinkedIn connection request', 'working'], ['instagram-msg', 'Touch: Instagram message', 'working'],
    ['in-person', 'Touch: In-person', 'working'], ['skip', 'Skip: Skipped — not a fit', 'dropped'],
  ])('preserves existing outcome behavior for %s', async (signal, prefix, stage) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ contact: { customFields: [] } })))
      .mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{}'));
    const ctx = context({ contactId: 'synthetic-contact', signal, note: 'Context', followupAt: '2099-01-01' });
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.newStage).toBe(stage);
    expect(body.touchCount).toBe(signal === 'skip' ? 0 : 1);
    expect(body.signalAt === null).toBe(signal === 'skip');
    expect(getGhlToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('https://services.leadconnectorhq.com/contacts/synthetic-contact');
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    expect(fetchMock.mock.calls[2][0]).toBe('https://services.leadconnectorhq.com/contacts/synthetic-contact/notes');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ body: `${prefix} — Context` });
  });
});

describe('Outreach outcome prerequisite reads', () => {
  it.each([
    ['provider rejection', () => new Response('{"error":"rate limited"}', { status: 429 })],
    ['network failure', () => Promise.reject(new Error('connect timeout'))],
    ['malformed success response', () => new Response('{}')],
  ])('fails closed on %s before updating fields or adding a note', async (_label, currentRead) => {
    fetchMock.mockImplementationOnce(currentRead);
    const ctx = context({ contactId: 'synthetic-contact', signal: 'voicemail' });

    const response = await onRequestPost(ctx);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/current outreach state could not be verified/i),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ctx.env.PORTAL_KV.delete).not.toHaveBeenCalled();
  });

  it('preserves the existing touch count and stage after a verified read', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ contact: { customFields: [
        { id: 'qKtPT2XZP61emgUDK7fd', value: 12 },
        { id: 'KfPow1mYDxJqiOCS6mDZ', value: 'future-potential' },
      ] } })))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}'));
    const ctx = context({ contactId: 'synthetic-contact', signal: 'voicemail' });

    const response = await onRequestPost(ctx);

    expect(response.status).toBe(200);
    const update = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(update.customFields).toContainEqual({ id: 'qKtPT2XZP61emgUDK7fd', value: 13 });
    expect(update.customFields).not.toContainEqual(expect.objectContaining({ id: 'KfPow1mYDxJqiOCS6mDZ' }));
  });
});
