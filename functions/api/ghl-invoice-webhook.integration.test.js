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
  applyTagDelta: vi.fn(async () => ({ added: [], removed: [] })),
}));

import { onRequestPost, INVOICE_PURCHASE_PRODUCTS } from './ghl-invoice-webhook.js';
import { ghlFetch, applyTagDelta } from '../lib/ghl.js';

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

function makeContext({ invoices, secret = SECRET, kvStore = {}, body = { contact_id: 'c1', invoice_id: 'inv1' }, contact = { id: 'c1', customFields: [], tags: [] }, verifiedContact = null, contactStatus = 200, attendDb = null, portalSale = null }) {
  let contactReads = 0;
  ghlFetch.mockImplementation(async (_ctx, url) => {
    if (url.includes('/invoices/')) return { ok: true, json: async () => ({ invoices }) };
    if (url.includes('/contacts/')) {
      const selected = contactReads++ > 0 && verifiedContact ? verifiedContact : contact;
      return { ok: contactStatus < 400, status: contactStatus, json: async () => ({ contact: selected }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  const env = {
    GHL_WEBHOOK_SECRET: SECRET,
    PURCHASE_KV: {
      get: vi.fn(async (k) => (k in kvStore ? kvStore[k] : null)),
      put: vi.fn(async (k, v) => { kvStore[k] = v; }),
    },
    ATTEND_DB: attendDb,
  };
  if (portalSale) {
    env.PORTAL_KV = {
      get: vi.fn(async (key) => key === `staff-pos:sale:${portalSale.id}` ? portalSale : null),
      put: vi.fn(async (_key, value) => { portalSale = JSON.parse(value); }),
    };
  }
  return { env, waitUntil: vi.fn(), request: { json: async () => body, headers: { get: (h) => (h === 'X-Webhook-Secret' ? secret : null) } } };
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
    // Tags are NOT in the PUT body — that would clobber concurrent workflow tags.
    expect(payload.tags).toBeUndefined();
    // The downstream cleanup trigger tag is applied additively instead.
    expect(applyTagDelta).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      expect.objectContaining({ add: ['invoice-series-purchased'] }),
    );
    expect(ctx.env.PURCHASE_KV.put).toHaveBeenCalledWith('invoice:inv1', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }));
  });

  it('a Staff POS invoice never applies the confirmation-email trigger tag', async () => {
    const invoice = {
      ...seriesInvoice('inv-pos'),
      name: 'Staff POS pos_messagequiet1',
      termsNotes: 'Payment already collected externally. Staff POS sale pos_messagequiet1. Do not send.',
    };
    const ctx = makeContext({
      invoices: [invoice],
      body: { contact_id: 'c1', invoice_id: 'inv-pos' },
      contact: {
        id: 'c1', tags: [],
        customFields: [
          { id: FIELD.sessionsRemaining, value: String(seriesPkg.sessionsRemaining) },
          { id: FIELD.seriesType, value: seriesPkg.seriesType },
          { id: FIELD.portalAccess, value: true },
          { id: FIELD.livingPractice, value: true },
        ],
      },
      portalSale: {
        id: 'pos_messagequiet1',
        status: 'paid',
        fulfillmentStatus: 'pending',
        client: { id: 'c1', name: 'Test' },
        cart: [{
          kind: 'catalog', label: seriesPkg.name, ghlProductId: SERIES_PID,
          quantity: 1, unitAmountCents: 129500, lineTotalCents: 129500,
        }],
        fulfillment: {
          adapter: 'ghl_invoice', stage: 'verification_pending',
          invoice: { id: 'inv-pos', status: 'paid' },
        },
        version: 2,
        audit: [],
      },
    });

    const res = await onRequestPost(ctx);

    expect(res.status).toBe(200);
    expect(applyTagDelta).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      expect.objectContaining({ add: [] }),
    );
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith(
      'staff-pos:sale:pos_messagequiet1',
      expect.stringContaining('"fulfillmentStatus":"fulfilled"'),
    );
    expect(await res.json()).toMatchObject({ posSaleId: 'pos_messagequiet1', posFulfilled: true });
  });

  it('a Staff POS Single Session adds exactly one credit, preserves the series, and verifies the checkpointed target', async () => {
    const invoice = {
      _id: 'inv-pos-single', status: 'paid', amountPaid: 285,
      name: 'Staff POS pos_singlecredit1',
      termsNotes: 'Payment already collected externally. Staff POS sale pos_singlecredit1. Do not send.',
      invoiceItems: [{ productId: '6a6b8bb7a1753b65945372f1', qty: 1 }],
    };
    const baseFields = [
      { id: FIELD.sessionsRemaining, value: '2' },
      { id: FIELD.seriesType, value: '12-week' },
      { id: FIELD.portalAccess, value: true },
    ];
    const ctx = makeContext({
      invoices: [invoice],
      body: { contact_id: 'c1', invoice_id: 'inv-pos-single' },
      contact: { id: 'c1', tags: [], customFields: baseFields },
      verifiedContact: {
        id: 'c1', tags: [],
        customFields: baseFields.map((field) => field.id === FIELD.sessionsRemaining ? { ...field, value: '3' } : field),
      },
      portalSale: {
        id: 'pos_singlecredit1', status: 'paid', fulfillmentStatus: 'pending',
        client: { id: 'c1', name: 'Test' },
        cart: [{
          kind: 'catalog', productKey: 'single-session', label: 'Single Session',
          ghlProductId: '6a6b8bb7a1753b65945372f1', fulfillmentPolicy: 'session-credit',
          quantity: 1, unitAmountCents: 28500, lineTotalCents: 28500,
        }],
        fulfillment: {
          adapter: 'ghl_invoice', stage: 'verification_pending',
          invoice: { id: 'inv-pos-single', status: 'paid' },
        },
        version: 2, audit: [],
      },
    });

    const res = await onRequestPost(ctx);

    expect(res.status).toBe(200);
    const payload = JSON.parse(putToContact().opts.body);
    expect(payload.customFields).toEqual(expect.arrayContaining([
      { id: FIELD.sessionsRemaining, field_value: '3' },
      { id: FIELD.portalAccess, field_value: true },
    ]));
    expect(payload.customFields.some((field) => field.id === FIELD.seriesType)).toBe(false);
    expect(await res.json()).toMatchObject({ posSaleId: 'pos_singlecredit1', posFulfilled: true, sessionsRemaining: 3 });
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith(
      'staff-pos:sale:pos_singlecredit1',
      expect.stringContaining('"sessionsRemaining":3'),
    );
  });

  it('a duplicate Single Session event waits instead of calculating a second target before the checkpoint is visible', async () => {
    const invoice = {
      _id: 'inv-pos-single-pending', status: 'paid', amountPaid: 285,
      name: 'Staff POS pos_singlepending1',
      termsNotes: 'Payment already collected externally. Staff POS sale pos_singlepending1. Do not send.',
      invoiceItems: [{ productId: '6a6b8bb7a1753b65945372f1', qty: 1 }],
    };
    const attendDb = {
      prepare: () => ({ bind() { return this; }, run: async () => ({ meta: { changes: 0 } }) }),
    };
    const ctx = makeContext({
      invoices: [invoice],
      body: { contact_id: 'c1', invoice_id: 'inv-pos-single-pending' },
      contact: {
        id: 'c1', tags: [],
        customFields: [
          { id: FIELD.sessionsRemaining, value: '3' },
          { id: FIELD.seriesType, value: '12-week' },
        ],
      },
      attendDb,
      portalSale: {
        id: 'pos_singlepending1', status: 'paid', fulfillmentStatus: 'pending',
        client: { id: 'c1', name: 'Test' },
        cart: [{
          kind: 'catalog', productKey: 'single-session', label: 'Single Session',
          ghlProductId: '6a6b8bb7a1753b65945372f1', fulfillmentPolicy: 'session-credit',
          quantity: 1, unitAmountCents: 28500, lineTotalCents: 28500,
        }],
        fulfillment: {
          adapter: 'ghl_invoice', stage: 'verification_pending',
          invoice: { id: 'inv-pos-single-pending', status: 'paid' },
        },
        version: 2, audit: [],
      },
    });

    const res = await onRequestPost(ctx);

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      pending: true,
      retryable: true,
      reason: 'single-session-target-not-yet-visible',
    });
    expect(putToContact()).toBeFalsy();
  });

  it('a duplicate Single Session event reuses the checkpointed target instead of adding again', async () => {
    const invoice = {
      _id: 'inv-pos-single-replay', status: 'paid', amountPaid: 285,
      name: 'Staff POS pos_singlereplay1',
      termsNotes: 'Payment already collected externally. Staff POS sale pos_singlereplay1. Do not send.',
      invoiceItems: [{ productId: '6a6b8bb7a1753b65945372f1', qty: 1 }],
    };
    const fields = [
      { id: FIELD.sessionsRemaining, value: '3' },
      { id: FIELD.seriesType, value: '12-week' },
      { id: FIELD.portalAccess, value: true },
    ];
    const attendDb = {
      prepare: () => ({ bind() { return this; }, run: async () => ({ meta: { changes: 0 } }) }),
    };
    const ctx = makeContext({
      invoices: [invoice],
      body: { contact_id: 'c1', invoice_id: 'inv-pos-single-replay' },
      contact: { id: 'c1', tags: [], customFields: fields },
      verifiedContact: { id: 'c1', tags: [], customFields: fields },
      attendDb,
      portalSale: {
        id: 'pos_singlereplay1', status: 'paid', fulfillmentStatus: 'pending',
        client: { id: 'c1', name: 'Test' },
        cart: [{
          kind: 'catalog', productKey: 'single-session', label: 'Single Session',
          ghlProductId: '6a6b8bb7a1753b65945372f1', fulfillmentPolicy: 'session-credit',
          quantity: 1, unitAmountCents: 28500, lineTotalCents: 28500,
        }],
        fulfillment: {
          adapter: 'ghl_invoice', stage: 'effect_target_checkpointed',
          invoice: { id: 'inv-pos-single-replay', status: 'paid' },
          effectTarget: { type: 'session_credit', sessionsRemaining: 3 },
        },
        version: 3, audit: [],
      },
    });

    const res = await onRequestPost(ctx);

    expect(res.status).toBe(200);
    const payload = JSON.parse(putToContact().opts.body);
    expect(payload.customFields).toEqual(expect.arrayContaining([
      { id: FIELD.sessionsRemaining, field_value: '3' },
      { id: FIELD.portalAccess, field_value: true },
    ]));
    expect(payload.customFields.some((field) => field.field_value === '4')).toBe(false);
    expect(await res.json()).toMatchObject({ posFulfilled: true, sessionsRemaining: 3 });
  });

  it('a Staff POS Living Practice sale grants portal and Living Practice access without touching sessions', async () => {
    const invoice = {
      _id: 'inv-pos-living', status: 'paid', amountPaid: 347,
      name: 'Staff POS pos_livingaccess1',
      termsNotes: 'Payment already collected externally. Staff POS sale pos_livingaccess1. Do not send.',
      invoiceItems: [{ productId: '6998d7f2606fa79c54fa3ff5', qty: 1 }],
    };
    const current = {
      id: 'c1', tags: [],
      customFields: [
        { id: FIELD.sessionsRemaining, value: '7' },
        { id: FIELD.seriesType, value: '12-week' },
      ],
    };
    const verified = {
      ...current,
      customFields: [
        ...current.customFields,
        { id: FIELD.portalAccess, value: true },
        { id: FIELD.livingPractice, value: true },
      ],
    };
    const ctx = makeContext({
      invoices: [invoice],
      body: { contact_id: 'c1', invoice_id: 'inv-pos-living' },
      contact: current,
      verifiedContact: verified,
      portalSale: {
        id: 'pos_livingaccess1', status: 'paid', fulfillmentStatus: 'pending',
        client: { id: 'c1', name: 'Test' },
        cart: [{
          kind: 'catalog', productKey: 'living-practice', label: 'Living Practice',
          ghlProductId: '6998d7f2606fa79c54fa3ff5', fulfillmentPolicy: 'living-practice-access',
          quantity: 1, unitAmountCents: 34700, lineTotalCents: 34700,
        }],
        fulfillment: {
          adapter: 'ghl_invoice', stage: 'verification_pending',
          invoice: { id: 'inv-pos-living', status: 'paid' },
        },
        version: 2, audit: [],
      },
    });

    const res = await onRequestPost(ctx);

    expect(res.status).toBe(200);
    expect(JSON.parse(putToContact().opts.body).customFields).toEqual([
      { id: FIELD.portalAccess, field_value: true },
      { id: FIELD.livingPractice, field_value: true },
    ]);
    expect(await res.json()).toMatchObject({ posSaleId: 'pos_livingaccess1', posFulfilled: true });
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith(
      'staff-pos:sale:pos_livingaccess1',
      expect.stringContaining('"type":"living_practice_access"'),
    );
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

  it('releases a won D1 claim when downstream contact fulfillment fails', async () => {
    const statements = [];
    const attendDb = {
      prepare: (sql) => {
        statements.push(sql);
        return { bind() { return this; }, run: async () => ({ meta: { changes: 1 } }) };
      },
    };
    const ctx = makeContext({
      invoices: [seriesInvoice('inv1')],
      contactStatus: 503,
      attendDb,
    });

    const res = await onRequestPost(ctx);

    expect(res.status).toBe(404);
    expect(statements.some((sql) => sql.includes('DELETE FROM processed_events'))).toBe(true);
  });
});
