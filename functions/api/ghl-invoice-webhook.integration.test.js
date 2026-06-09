// Integration tests for the invoice-webhook WRITE orchestration.
// Pure helpers (classifyInvoiceProduct, selectSeriesInvoice) are covered in
// ghl-invoice-webhook.test.js. This exercises onRequestPost end-to-end with
// mocked GHL I/O + global fetch: does a paid series INVOICE actually SET the
// fields the C-series workflows would, skip non-series, and stay idempotent?

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ghl.js', () => ({
  ghlFetch: vi.fn(),
  ghlHeaders: vi.fn(() => ({ Authorization: 'Bearer tok' })),
  getGhlToken: vi.fn(async () => 'tok'),
}));

import { onRequestPost, INVOICE_PURCHASE_PRODUCTS } from './ghl-invoice-webhook.js';
import { ghlFetch } from '../lib/ghl.js';

const SECRET = 'shh';
const FIELD = {
  sessionsRemaining: 'wrQSkx6BhXwDGIn1d0V4',
  seriesType: '3i93lTkmuAV49s9nh0q8',
  portalAccess: 'O0xmwyRqeNK2EA1GGGye',
  livingPractice: '1EnVtI70jC5MTshZjWvw',
};

// An 8-session series product from the live invoice-purchase map (SET + LP).
const [SERIES_PID, seriesPkg] = Object.entries(INVOICE_PURCHASE_PRODUCTS).find(([, p]) => p.seriesType === '8-session');

let fetchCalls;
const putToContact = () => fetchCalls.find((c) => c.opts?.method === 'PUT' && /\/contacts\//.test(c.url));

function makeContext({ invoices, secret = SECRET, kvStore = {}, body = { contact_id: 'c1', invoice_id: 'inv1' }, contact = { id: 'c1', customFields: [], tags: [] } }) {
  ghlFetch.mockImplementation(async (_ctx, url) => {
    if (url.includes('/invoices/')) return { ok: true, json: async () => ({ invoices }) };
    if (url.includes('/contacts/')) return { ok: true, json: async () => ({ contact }) };
    return { ok: true, json: async () => ({}) };
  });
  const env = {
    GHL_WEBHOOK_SECRET: SECRET,
    PURCHASE_KV: {
      get: vi.fn(async (k) => (k in kvStore ? kvStore[k] : null)),
      put: vi.fn(async (k, v) => { kvStore[k] = v; }),
    },
  };
  return { env, request: { json: async () => body, headers: { get: (h) => (h === 'X-Webhook-Secret' ? secret : null) } } };
}

const seriesInvoice = (id = 'inv1') => ({ _id: id, status: 'paid', amountPaid: 1295, invoiceItems: [{ productId: SERIES_PID }] });

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  global.fetch = vi.fn(async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { ok: true, json: async () => ({}), text: async () => '' };
  });
});

describe('invoice-webhook — write orchestration', () => {
  it('rejects an invalid secret (401, no write)', async () => {
    const ctx = makeContext({ invoices: [seriesInvoice()], secret: 'wrong' });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
    expect(putToContact()).toBeFalsy();
  });

  it('paid 8-series invoice → SETs sessions_remaining + series_type + portal + LP, adds the downstream tag, writes the lock', async () => {
    const ctx = makeContext({ invoices: [seriesInvoice('inv1')] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);

    const put = putToContact();
    expect(put).toBeTruthy();
    const payload = JSON.parse(put.opts.body);
    expect(payload.customFields).toEqual(expect.arrayContaining([
      { id: FIELD.sessionsRemaining, field_value: String(seriesPkg.sessionsRemaining) }, // SET
      { id: FIELD.seriesType, field_value: '8-session' },
      { id: FIELD.portalAccess, field_value: true },
      { id: FIELD.livingPractice, field_value: true },
    ]));
    expect(payload.tags).toContain('invoice-series-purchased'); // downstream cleanup trigger
    expect(ctx.env.PURCHASE_KV.put).toHaveBeenCalledWith('invoice:inv1', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }));
  });

  it('no series/upgrade invoice → 200 no-op, no contact PUT', async () => {
    const ctx = makeContext({ invoices: [] });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).skipped).toBe(true);
    expect(putToContact()).toBeFalsy();
  });

  it('already-processed invoice → skip, no contact PUT (idempotency)', async () => {
    const ctx = makeContext({ invoices: [seriesInvoice('inv1')], kvStore: { 'invoice:inv1': JSON.stringify({ processedAt: 'earlier' }) } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).alreadyProcessed).toBe(true);
    expect(putToContact()).toBeFalsy();
  });
});
