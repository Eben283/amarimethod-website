// Integration tests for the purchase-webhook WRITE orchestration.
// The pure helpers (resolveOrderProductId, PRODUCT_MAP, KV TTL) are covered in
// ghl-purchase-webhook.test.js. This exercises onRequestPost end-to-end with
// mocked GHL I/O + global fetch, asserting the actual contact PUT and the
// idempotency lock — the glue that silently credits wrong if it regresses.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ghl.js', () => ({
  ghlFetch: vi.fn(),
  ghlHeaders: vi.fn(() => ({ Authorization: 'Bearer tok' })),
  getGhlToken: vi.fn(async () => 'tok'),
}));

import { onRequestPost, PRODUCT_MAP, KV_TTL_SECONDS } from './ghl-purchase-webhook.js';
import { ghlFetch } from '../lib/ghl.js';

const SECRET = 'shh';
const FIELD = {
  sessionsRemaining: 'wrQSkx6BhXwDGIn1d0V4',
  seriesType: '3i93lTkmuAV49s9nh0q8',
  portalAccess: 'O0xmwyRqeNK2EA1GGGye',
  livingPractice: '1EnVtI70jC5MTshZjWvw',
};

// An 8-session series product from the live map (SET semantics + LP).
const seriesEntry = Object.entries(PRODUCT_MAP).find(([, p]) => p.seriesType === '8-session');
const [SERIES_ID, seriesPkg] = seriesEntry;
const SINGLE_ID = '67f57171b6b1019c7b0233cc'; // legacy single follow-up — ADD +1, seriesType null

let fetchCalls;

function makeContext({ body, secret = SECRET, kvStore = {}, contact = { id: 'c1', customFields: [] } }) {
  ghlFetch.mockImplementation(async (_ctx, url) => {
    if (url.includes('/contacts/') && !/\/(appointments|notes|tags)/.test(url)) {
      return { ok: true, json: async () => ({ contact }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  const env = {
    GHL_WEBHOOK_SECRET: SECRET,
    PURCHASE_KV: {
      get: vi.fn(async (k) => (k in kvStore ? kvStore[k] : null)),
      put: vi.fn(async (k, v) => { kvStore[k] = v; }),
    },
  };
  const request = {
    json: async () => body,
    headers: { get: (h) => (h === 'X-Webhook-Secret' ? secret : null) },
  };
  return { env, request };
}

const putToContact = () =>
  fetchCalls.find((c) => c.opts?.method === 'PUT' && /\/contacts\//.test(c.url));

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  global.fetch = vi.fn(async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { ok: true, json: async () => ({}), text: async () => '' };
  });
});

describe('purchase-webhook — write orchestration', () => {
  it('rejects an invalid webhook secret (401, no write)', async () => {
    const ctx = makeContext({ body: { contact_id: 'c1', product_id: SERIES_ID, order_id: 'o1' }, secret: 'wrong' });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
    expect(putToContact()).toBeFalsy();
  });

  it('SERIES purchase → SETs sessions_remaining to pack size + series_type + portal + LP, writes the lock', async () => {
    const ctx = makeContext({ body: { contact_id: 'c1', product_id: SERIES_ID, order_id: 'o1' } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);

    const put = putToContact();
    expect(put).toBeTruthy();
    const fields = JSON.parse(put.opts.body).customFields;
    expect(fields).toEqual(expect.arrayContaining([
      { id: FIELD.sessionsRemaining, field_value: String(seriesPkg.sessionsToAdd) }, // SET, not ADD
      { id: FIELD.seriesType, field_value: '8-session' },
      { id: FIELD.portalAccess, field_value: true },
      { id: FIELD.livingPractice, field_value: true },
    ]));
    expect(ctx.env.PURCHASE_KV.put).toHaveBeenCalledWith(
      'order:o1', expect.any(String), expect.objectContaining({ expirationTtl: KV_TTL_SECONDS }),
    );
  });

  it('SINGLE follow-up → ADDs +1 to the existing balance (does not reset)', async () => {
    const contact = { id: 'c2', customFields: [{ id: FIELD.sessionsRemaining, value: '3' }] };
    const ctx = makeContext({ body: { contact_id: 'c2', product_id: SINGLE_ID, order_id: 'o2' }, contact });
    await onRequestPost(ctx);

    const fields = JSON.parse(putToContact().opts.body).customFields;
    expect(fields).toContainEqual({ id: FIELD.sessionsRemaining, field_value: '4' }); // 3 + 1
  });

  it('already-processed order → skip, no contact PUT (idempotency)', async () => {
    const ctx = makeContext({
      body: { contact_id: 'c1', product_id: SERIES_ID, order_id: 'o1' },
      kvStore: { 'order:o1': JSON.stringify({ processedAt: 'earlier' }) },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).alreadyProcessed).toBe(true);
    expect(putToContact()).toBeFalsy();
  });
});
