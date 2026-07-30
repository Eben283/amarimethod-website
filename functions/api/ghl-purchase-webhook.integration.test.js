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
const ASSESSMENT_ID = '6a66cf0103821ea09ea13f1b';
const ASSESSMENT_CALENDAR_ID = 'EM6vB2mq7EAdGCbUb3j1';

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

  it('Assessment payment → books its selected 40-minute appointment, with no session or portal-field writes', async () => {
    const contact = {
      id: 'assessment-contact',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '4155550100',
      customFields: [
        { fieldKey: 'requested_session_slot', value: '2026-08-03T10:00:00-07:00' },
        { fieldKey: 'requested_session_calendar', value: ASSESSMENT_CALENDAR_ID },
        { fieldKey: 'requested_session_type', value: 'amari_assessment' },
      ],
    };
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'assessment-order-1' },
      contact,
    });

    const res = await onRequestPost(ctx);

    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toMatchObject({
      success: true,
      product: 'Amari Assessment',
      sessionsAdded: 0,
    });
    expect(putToContact()).toBeFalsy();

    const appointmentCreate = fetchCalls.find((call) =>
      call.url.endsWith('/calendars/events/appointments') && call.opts?.method === 'POST',
    );
    expect(appointmentCreate).toBeTruthy();
    expect(JSON.parse(appointmentCreate.opts.body)).toMatchObject({
      calendarId: ASSESSMENT_CALENDAR_ID,
      contactId: contact.id,
      startTime: '2026-08-03T10:00:00-07:00',
      endTime: '2026-08-03T10:40:00-07:00',
      title: 'Amari Assessment — In Person',
      appointmentStatus: 'confirmed',
    });

    expect(ghlFetch).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining(`/contacts/${contact.id}/tags`),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tags: ['paid-via-native-checkout'] }) }),
    );
    expect(ctx.env.PURCHASE_KV.put).toHaveBeenCalledWith(
      'order:assessment-order-1',
      expect.stringContaining('"sessionsAdded":0'),
      expect.objectContaining({ expirationTtl: KV_TTL_SECONDS }),
    );
  });

  // Holly Brinkman 2026-07-29: GHL contact GET returns `{id,value}` only (no
  // fieldKey), and the DATE slot field truncates to YYYY-MM-DD. Webhook must
  // still book from requested_session_slot_iso (TEXT) resolved by field id.
  it('Assessment payment with id-only custom fields + slot_iso TEXT still auto-books', async () => {
    const contact = {
      id: 'holly-shape',
      firstName: 'Holly',
      lastName: 'Brinkman',
      email: 'holly@example.com',
      phone: '4155550199',
      tags: ['native-booking-started', 'agreed-pma-v2026-06-16'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'vDAcRQ998BBVeHcdAnkl', value: ASSESSMENT_CALENDAR_ID },
        { id: 'U4CngR3hNQFlGHIh8TkM', value: '2026-08-04' }, // DATE truncation
        { id: 'Qj3v47KwlOkLwmCWkqAW', value: '2026-08-04T11:00:00-07:00' }, // TEXT iso
      ],
    };
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'holly-order' },
      contact,
    });
    ctx.waitUntil = vi.fn();

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body.success).toBe(true);
    expect(body.sessionsAdded).toBe(0);

    const appointmentCreate = fetchCalls.find((call) =>
      call.url.endsWith('/calendars/events/appointments') && call.opts?.method === 'POST',
    );
    expect(appointmentCreate).toBeTruthy();
    expect(JSON.parse(appointmentCreate.opts.body)).toMatchObject({
      calendarId: ASSESSMENT_CALENDAR_ID,
      contactId: contact.id,
      startTime: '2026-08-04T11:00:00-07:00',
      endTime: '2026-08-04T11:40:00-07:00',
    });
  });

  it('Assessment payment with date-only slot recovers time from checkout note', async () => {
    const contact = {
      id: 'note-fallback',
      firstName: 'Note',
      lastName: 'Fallback',
      tags: ['native-booking-started'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'vDAcRQ998BBVeHcdAnkl', value: ASSESSMENT_CALENDAR_ID },
        { id: 'U4CngR3hNQFlGHIh8TkM', value: '2026-08-04' },
      ],
    };
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'note-order' },
      contact,
    });
    ctx.waitUntil = vi.fn();
    ghlFetch.mockImplementation(async (_ctx, url) => {
      if (url.includes('/contacts/') && url.includes('/notes')) {
        return {
          ok: true,
          json: async () => ({
            notes: [{
              body: [
                'Native booking flow — checkout initiated',
                '',
                'Requested slot: 2026-08-04T11:00:00-07:00 (America/Los_Angeles)',
              ].join('\n'),
            }],
          }),
        };
      }
      if (url.includes('/contacts/') && !/\/(appointments|notes|tags)/.test(url)) {
        return { ok: true, json: async () => ({ contact }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const appointmentCreate = fetchCalls.find((call) =>
      call.url.endsWith('/calendars/events/appointments') && call.opts?.method === 'POST',
    );
    expect(appointmentCreate).toBeTruthy();
    expect(JSON.parse(appointmentCreate.opts.body).startTime).toBe('2026-08-04T11:00:00-07:00');
  });

  it('Assessment native checkout with no bookable slot posts URGENT reconcile note', async () => {
    const contact = {
      id: 'no-slot',
      tags: ['native-booking-started'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'U4CngR3hNQFlGHIh8TkM', value: '2026-08-04' }, // date only, no iso, no note
      ],
    };
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'noslot-order' },
      contact,
    });
    ctx.waitUntil = vi.fn();

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body.appointmentId).toBeNull();

    const urgentNote = [...ghlFetch.mock.calls].find(([, url, opts]) =>
      url.includes('/notes') && opts?.method === 'POST' &&
      String(opts.body || '').includes('URGENT — RECONCILE NEEDED'),
    );
    expect(urgentNote).toBeTruthy();
    const appointmentCreate = fetchCalls.find((call) =>
      call.url.endsWith('/calendars/events/appointments') && call.opts?.method === 'POST',
    );
    expect(appointmentCreate).toBeFalsy();
  });

  // Amari Ops Phase 1: Holly-class fail must leave a reconstructable trail
  // (payment hop + create_appointment fail with slot condition + open incident).
  it('Assessment no-slot fail writes ops_events + opens money incident when AUTOMATION_DB is bound', async () => {
    const opsRows = [];
    const incidents = [];
    const db = {
      prepare: (sql) => ({
        _a: [],
        bind(...a) { this._a = a; return this; },
        async run() {
          if (/INSERT INTO ops_events/.test(sql)) {
            opsRows.push({
              path_id: this._a[3], hop_id: this._a[4], outcome: this._a[5],
              summary: this._a[7], correlation_id: this._a[8],
              condition_expected: this._a[13], condition_observed: this._a[14],
            });
          }
          if (/INSERT INTO ops_incidents/.test(sql)) {
            incidents.push({
              path_id: this._a[1], status: this._a[2], severity: this._a[3],
              title: this._a[8], correlation_id: this._a[11], law_id: this._a[14],
            });
          }
          return { meta: { changes: 1 } };
        },
        async first() { return null; },
        async all() { return { results: [] }; },
      }),
    };

    const contact = {
      id: 'holly-ops',
      firstName: 'Holly',
      lastName: 'Brinkman',
      tags: ['native-booking-started'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'U4CngR3hNQFlGHIh8TkM', value: '2026-08-04' },
      ],
    };
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'holly-ops-order' },
      contact,
    });
    ctx.env.AUTOMATION_DB = db;
    ctx.env.OPS_ALERT_MODE = 'shadow';
    ctx.env.OPS_ALERT_CONTACT_ID = 'ebenOps';

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);

    expect(opsRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path_id: 'assessment_paid_book',
        hop_id: 'purchase_webhook',
        outcome: 'ok',
        correlation_id: 'order:holly-ops-order',
      }),
      expect.objectContaining({
        path_id: 'assessment_paid_book',
        hop_id: 'create_appointment',
        outcome: 'fail',
        condition_expected: 'requested_session_slot_iso bookable datetime',
      }),
    ]));
    const fail = opsRows.find((r) => r.hop_id === 'create_appointment');
    expect(fail.condition_observed).toMatch(/slot_iso=null/);
    expect(incidents).toEqual([
      expect.objectContaining({
        path_id: 'assessment_paid_book',
        status: 'open',
        severity: 'money',
        title: 'Paid Assessment, no appointment',
        law_id: 'L_paid_assessment_has_appt',
      }),
    ]);
  });
});
