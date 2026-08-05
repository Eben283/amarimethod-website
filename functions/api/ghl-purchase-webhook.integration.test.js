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

function requestedSlot(contact) {
  return contact?.customFields?.find((field) =>
    field.fieldKey === 'requested_session_slot_iso' ||
    field.fieldKey === 'requested_session_slot' ||
    field.id === 'Qj3v47KwlOkLwmCWkqAW'
  )?.value || null;
}

function makeContext({ body, secret = SECRET, kvStore = {}, contact = { id: 'c1', customFields: [] }, attendDb, intentSlot }) {
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
  if (body?.product_id === ASSESSMENT_ID) {
    const slot = intentSlot === undefined ? requestedSlot(contact) : intentSlot;
    env.ATTEND_DB = attendDb || makeAttendDb();
    if (slot) env.ATTEND_DB.seedIntent({
      intentId: `intent-${body.order_id}`,
      contactId: body.contact_id,
      productId: ASSESSMENT_ID,
      calendarId: ASSESSMENT_CALENDAR_ID,
      startTime: slot,
    });
  } else if (attendDb) {
    env.ATTEND_DB = attendDb;
  }
  const request = {
    json: async () => body,
    headers: { get: (h) => (h === 'X-Webhook-Secret' ? secret : null) },
  };
  return { env, request };
}

function makeAttendDb() {
  const rows = new Set();
  const intents = new Map();
  const operations = new Map();
  return {
    seedIntent({ intentId, contactId, productId, calendarId, startTime }) {
      if (intents.has(intentId)) return;
      const now = Date.now() - 1000;
      intents.set(intentId, {
        intent_id: intentId, contact_id: contactId, product_id: productId,
        calendar_id: calendarId, start_time: startTime,
        timezone: 'America/Los_Angeles', status: 'pending', order_id: null,
        appointment_id: null, created_at: now, expires_at: now + 86_400_000,
        updated_at: now,
      });
    },
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          if (/^INSERT INTO processed_events/.test(sql)) {
            const key = args[0];
            if (rows.has(key)) return { meta: { changes: 0 } };
            rows.add(key);
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM processed_events/.test(sql)) {
            const key = args[0];
            const deleted = rows.delete(key);
            return { meta: { changes: deleted ? 1 : 0 } };
          }
          if (sql.startsWith('INSERT INTO booking_operations')) {
            const [opKey, kind, contactId, calendarId, startTime, leaseUntil, createdAt, updatedAt] = args;
            if (operations.has(opKey)) return { meta: { changes: 0 } };
            operations.set(opKey, { op_key: opKey, kind, contact_id: contactId, calendar_id: calendarId, start_time: startTime, status: 'processing', appointment_id: null, result_json: null, lease_until: leaseUntil, attempts: 1, last_error: null, created_at: createdAt, updated_at: updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('attempts = attempts + 1')) {
            const [leaseUntil, now, opKey, cutoff] = args;
            const row = operations.get(opKey);
            if (!row || row.lease_until > cutoff) return { meta: { changes: 0 } };
            Object.assign(row, { status: 'processing', lease_until: leaseUntil, attempts: row.attempts + 1, updated_at: now, last_error: null });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('SET appointment_id = ?') && sql.includes('booking_operations')) {
            const [appointmentId, leaseUntil, now, opKey] = args;
            const row = operations.get(opKey);
            if (!row || row.status !== 'processing') return { meta: { changes: 0 } };
            Object.assign(row, { appointment_id: appointmentId, lease_until: leaseUntil, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'completed'") && sql.includes('booking_operations')) {
            const [resultJson, now, opKey] = args;
            const row = operations.get(opKey);
            if (!row || row.status !== 'processing') return { meta: { changes: 0 } };
            Object.assign(row, { status: 'completed', result_json: resultJson, lease_until: 0, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('SET status = ?') && sql.includes('booking_operations')) {
            const [status, error, now, opKey] = args;
            const row = operations.get(opKey);
            if (!row || row.status !== 'processing') return { meta: { changes: 0 } };
            Object.assign(row, { status, last_error: error, lease_until: 0, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'bound'") && sql.includes('paid_booking_intents')) {
            const [orderId, now, intentId] = args;
            const row = intents.get(intentId);
            if (!row || row.status !== 'pending') return { meta: { changes: 0 } };
            Object.assign(row, { status: 'bound', order_id: orderId, updated_at: now });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'completed'") && sql.includes('paid_booking_intents')) {
            const [appointmentId, now, intentId] = args;
            const row = intents.get(intentId);
            if (!row || !['bound', 'completed'].includes(row.status)) return { meta: { changes: 0 } };
            Object.assign(row, { status: 'completed', appointment_id: appointmentId, updated_at: now });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('FROM paid_booking_intents WHERE order_id')) return [...intents.values()].find((row) => row.order_id === args[0]) || null;
          if (sql.includes('FROM booking_operations')) return operations.get(args[0]) || null;
          return null;
        },
        async all() {
          if (sql.includes('FROM paid_booking_intents')) {
            const [contactId, productId, createdCutoff, expiryCutoff] = args;
            return { results: [...intents.values()].filter((row) => row.contact_id === contactId && row.product_id === productId && row.status === 'pending' && row.created_at <= createdCutoff && row.expires_at >= expiryCutoff).slice(0, 3) };
          }
          return { results: [] };
        },
      };
    },
    rows,
    intents,
    operations,
  };
}

const putToContact = () =>
  fetchCalls.find((c) => c.opts?.method === 'PUT' && /\/contacts\//.test(c.url));

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  global.fetch = vi.fn(async (url, opts) => {
    fetchCalls.push({ url, opts });
    const isAppointmentCreate = String(url).endsWith('/calendars/events/appointments') && opts?.method === 'POST';
    return { ok: true, status: 200, json: async () => (isAppointmentCreate ? { id: 'appt_native_1' } : {}), text: async () => '' };
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

  it('Assessment payment → books its selected 50-minute appointment, with no session or portal-field writes', async () => {
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
      endTime: '2026-08-03T10:50:00-07:00',
      title: 'Amari Assessment — In Person',
      appointmentStatus: 'new',
    });
    const appointmentConfirm = fetchCalls.find((call) =>
      call.url.endsWith('/calendars/events/appointments/appt_native_1') && call.opts?.method === 'PUT',
    );
    expect(JSON.parse(appointmentConfirm.opts.body)).toEqual({ appointmentStatus: 'confirmed' });

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
      endTime: '2026-08-04T11:50:00-07:00',
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
      intentSlot: '2026-08-04T11:00:00-07:00',
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

  it('Assessment payment with no durable checkout intent fails closed before appointment creation', async () => {
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
    expect(res.status).toBe(500);
    const body = JSON.parse(await res.text());
    expect(body.retryable).toBe(true);
    expect(body.error).toBe('Paid booking intent not found');
    const appointmentCreate = fetchCalls.find((call) =>
      call.url.endsWith('/calendars/events/appointments') && call.opts?.method === 'POST',
    );
    expect(appointmentCreate).toBeFalsy();
  });

  it('Assessment booking failure releases its order claim and returns retryable failure', async () => {
    const contact = {
      id: 'assessment-retry',
      tags: ['native-booking-started'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'vDAcRQ998BBVeHcdAnkl', value: ASSESSMENT_CALENDAR_ID },
        { id: 'Qj3v47KwlOkLwmCWkqAW', value: '2026-08-21T11:00:00-07:00' },
      ],
    };
    const db = makeAttendDb();
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'assessment-retry-order' },
      contact,
      attendDb: db,
    });
    global.fetch = vi.fn(async (url, opts) => {
      fetchCalls.push({ url, opts });
      if (String(url).endsWith('/calendars/events/appointments') && opts?.method === 'POST') {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'temporary calendar failure' };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });

    const failed = await onRequestPost(ctx);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ success: false, retryable: true, appointmentId: null });
    expect(db.operations.get('paid-assessment:assessment-retry-order')?.status).toBe('retryable');
    expect(ctx.env.PURCHASE_KV.put.mock.calls.some(([key]) => key === 'order:assessment-retry-order')).toBe(false);

    const retry = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'assessment-retry-order' },
      contact,
      attendDb: db,
    });
    retry.env.ATTEND_DB = db;
    global.fetch = vi.fn(async (url, opts) => {
      fetchCalls.push({ url, opts });
      const creating = String(url).endsWith('/calendars/events/appointments') && opts?.method === 'POST';
      return { ok: true, status: 200, json: async () => creating ? { id: 'appt_retry_ok' } : {}, text: async () => '' };
    });
    const recovered = await onRequestPost(retry);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ appointmentId: 'appt_retry_ok' });
    expect(db.operations.get('paid-assessment:assessment-retry-order')?.status).toBe('completed');
  });

  it('Assessment contact-fetch failure releases its order claim for redelivery', async () => {
    const db = makeAttendDb();
    const ctx = makeContext({
      body: {
        contact_id: 'assessment-contact-fetch-fail',
        product_id: ASSESSMENT_ID,
        order_id: 'assessment-contact-fetch-order',
        createdAt: new Date().toISOString(),
      },
      attendDb: db,
      intentSlot: '2026-08-21T12:00:00-07:00',
    });
    ctx.waitUntil = vi.fn();
    ghlFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const failed = await onRequestPost(ctx);

    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      error: 'Contact not found',
      retryable: true,
    });
    expect(db.operations.get('paid-assessment:assessment-contact-fetch-order')?.status).toBe('retryable');
    expect(ctx.env.PURCHASE_KV.put.mock.calls.some(
      ([key]) => key === 'order:assessment-contact-fetch-order',
    )).toBe(false);
  });

  it('Assessment retry confirms an existing new appointment instead of treating it as fulfilled', async () => {
    const slot = '2026-08-21T14:00:00-07:00';
    const contact = {
      id: 'assessment-existing-new',
      tags: ['native-booking-started'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'vDAcRQ998BBVeHcdAnkl', value: ASSESSMENT_CALENDAR_ID },
        { id: 'Qj3v47KwlOkLwmCWkqAW', value: slot },
      ],
    };
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'assessment-new-order' },
      contact,
    });
    ghlFetch.mockImplementation(async (_ctx, url) => {
      if (url.endsWith(`/contacts/${contact.id}`)) {
        return { ok: true, json: async () => ({ contact }) };
      }
      if (url.endsWith(`/contacts/${contact.id}/appointments`)) {
        return {
          ok: true,
          json: async () => ({ events: [{
            id: 'appt_existing_new',
            calendarId: ASSESSMENT_CALENDAR_ID,
            startTime: slot,
            appointmentStatus: 'new',
          }] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ appointmentId: 'appt_existing_new' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/calendars\/events\/appointments\/appt_existing_new$/),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ appointmentStatus: 'confirmed' }) }),
    );
    expect(global.fetch.mock.calls.some(([url, opts]) =>
      String(url).endsWith('/calendars/events/appointments') && opts?.method === 'POST')).toBe(false);
  });

  it('does not treat an unrelated future Assessment as fulfillment of the paid slot', async () => {
    const paidSlot = '2026-08-21T14:00:00-07:00';
    const contact = {
      id: 'assessment-different-slot',
      tags: ['native-booking-started'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'vDAcRQ998BBVeHcdAnkl', value: ASSESSMENT_CALENDAR_ID },
        { id: 'Qj3v47KwlOkLwmCWkqAW', value: paidSlot },
      ],
    };
    const ctx = makeContext({
      body: { contact_id: contact.id, product_id: ASSESSMENT_ID, order_id: 'assessment-different-order' },
      contact,
    });
    ghlFetch.mockImplementation(async (_ctx, url) => {
      if (url.endsWith(`/contacts/${contact.id}`)) {
        return { ok: true, json: async () => ({ contact }) };
      }
      if (url.endsWith(`/contacts/${contact.id}/appointments`)) {
        return {
          ok: true,
          json: async () => ({ events: [{
            id: 'appt_other_time',
            calendarId: ASSESSMENT_CALENDAR_ID,
            startTime: '2026-08-21T09:00:00-07:00',
            appointmentStatus: 'confirmed',
          }] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ appointmentId: 'appt_native_1' });
    expect(global.fetch.mock.calls.some(([url, opts]) =>
      String(url).endsWith('/calendars/events/appointments') && opts?.method === 'POST')).toBe(true);
  });

  it('never guesses a slot when two durable Assessment intents match one paid order', async () => {
    const db = makeAttendDb();
    db.seedIntent({
      intentId: 'intent-a', contactId: 'assessment-ambiguous', productId: ASSESSMENT_ID,
      calendarId: ASSESSMENT_CALENDAR_ID, startTime: '2026-08-22T10:00:00-07:00',
    });
    db.seedIntent({
      intentId: 'intent-b', contactId: 'assessment-ambiguous', productId: ASSESSMENT_ID,
      calendarId: ASSESSMENT_CALENDAR_ID, startTime: '2026-08-22T11:00:00-07:00',
    });
    const ctx = makeContext({
      body: { contact_id: 'assessment-ambiguous', product_id: ASSESSMENT_ID, order_id: 'ambiguous-order' },
      attendDb: db,
      intentSlot: null,
    });

    const response = await onRequestPost(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: false, manualReview: true });
    expect(global.fetch.mock.calls.some(([url, opts]) =>
      String(url).endsWith('/calendars/events/appointments') && opts?.method === 'POST')).toBe(false);
  });

  it('fails closed when Assessment appointment reconciliation cannot be read', async () => {
    const slot = '2026-08-21T15:00:00-07:00';
    const contact = {
      id: 'assessment-reconcile-fail',
      tags: ['native-booking-started'],
      customFields: [
        { id: '4UZAVKtF7aGFPM51XUz4', value: 'amari_assessment' },
        { id: 'vDAcRQ998BBVeHcdAnkl', value: ASSESSMENT_CALENDAR_ID },
        { id: 'Qj3v47KwlOkLwmCWkqAW', value: slot },
      ],
    };
    const db = makeAttendDb();
    const ctx = makeContext({
      body: {
        contact_id: contact.id,
        product_id: ASSESSMENT_ID,
        order_id: 'assessment-reconcile-order',
      },
      contact,
      attendDb: db,
    });
    ghlFetch.mockImplementation(async (_ctx, url) => {
      if (url.endsWith(`/contacts/${contact.id}`)) {
        return { ok: true, json: async () => ({ contact }) };
      }
      if (url.endsWith(`/contacts/${contact.id}/appointments`)) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const failed = await onRequestPost(ctx);

    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ success: false, retryable: true });
    expect(db.operations.get('paid-assessment:assessment-reconcile-order')?.status).toBe('retryable');
    expect(global.fetch.mock.calls.some(([url, opts]) =>
      String(url).endsWith('/calendars/events/appointments') && opts?.method === 'POST')).toBe(false);
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
    expect(res.status).toBe(500);

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
        condition_expected: 'exactly one durable paid-booking intent',
      }),
    ]));
    const fail = opsRows.find((r) => r.hop_id === 'create_appointment');
    expect(fail.condition_observed).toMatch(/no compatible intent/);
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
