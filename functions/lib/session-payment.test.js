import { describe, it, expect } from 'vitest';
import {
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  paymentKey,
  contactPrefix,
  buildPaymentRecord,
  resolveSessionPayment,
  readPaymentRecord,
  writePaymentRecord,
  listPaymentRecordsForContact,
} from './session-payment.js';

// In-memory KV double matching the Cloudflare KV surface we use (get/put/list).
function mockKv() {
  const store = new Map();
  return {
    store,
    async get(k, type) {
      const v = store.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, v); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
    },
  };
}

describe('constants', () => {
  it('expose the payment statuses and methods as frozen lists', () => {
    expect(PAYMENT_STATUSES).toContain('comped');
    expect(PAYMENT_STATUSES).toContain('on-package');
    expect(PAYMENT_METHODS).toContain('cash');
    expect(Object.isFrozen(PAYMENT_STATUSES)).toBe(true);
  });
});

describe('paymentKey / contactPrefix', () => {
  it('builds the namespaced key', () => {
    expect(paymentKey('c1', 'a1')).toBe('payment:c1:a1');
  });
  it('builds the contact list prefix', () => {
    expect(contactPrefix('c1')).toBe('payment:c1:');
  });
  it('throws on missing ids', () => {
    expect(() => paymentKey('', 'a1')).toThrow();
    expect(() => paymentKey('c1', '')).toThrow();
    expect(() => contactPrefix('')).toThrow();
  });
});

describe('buildPaymentRecord', () => {
  it('builds a valid normalized, frozen record', () => {
    const r = buildPaymentRecord({
      contactId: 'c1', appointmentId: 'a1', status: 'comped',
      note: 'rare 2nd comp', recordedBy: 'garrett', at: '2026-06-04T00:00:00Z',
    });
    expect(r.status).toBe('comped');
    expect(r.note).toBe('rare 2nd comp');
    expect(r.source).toBe('manual');
    expect(r.method).toBeNull();
    expect(Object.isFrozen(r)).toBe(true);
  });
  it('requires contactId and appointmentId', () => {
    expect(() => buildPaymentRecord({ appointmentId: 'a1', status: 'paid' })).toThrow();
    expect(() => buildPaymentRecord({ contactId: 'c1', status: 'paid' })).toThrow();
  });
  it('rejects an invalid status', () => {
    expect(() => buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'bogus' })).toThrow();
  });
  it('rejects an invalid method', () => {
    expect(() => buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'paid', method: 'bitcoin' })).toThrow();
  });
  it('rejects an unknown source', () => {
    expect(() => buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'paid', source: 'magic' })).toThrow();
  });
  it('accepts the stripe-auto source', () => {
    const r = buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'paid', method: 'stripe', source: 'stripe-auto' });
    expect(r.source).toBe('stripe-auto');
  });
  it('rejects a negative amount', () => {
    expect(() => buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'paid', amount: -5 })).toThrow();
  });
  it('truncates an overlong note', () => {
    const r = buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'comped', note: 'x'.repeat(5000) });
    expect(r.note.length).toBe(1000);
  });
  it('does not mutate its input', () => {
    const input = { contactId: 'c1', appointmentId: 'a1', status: 'paid' };
    buildPaymentRecord(input);
    expect(input.source).toBeUndefined();
  });
});

describe('resolveSessionPayment', () => {
  const base = { contactId: 'c1', appointmentId: 'a1' };

  it('honors an explicit human answer (comp with note)', () => {
    const r = resolveSessionPayment({ ...base, explicitStatus: 'comped', note: 'rare 2nd comp', recordedBy: 'garrett', at: 't' });
    expect(r).toMatchObject({ status: 'comped', note: 'rare 2nd comp', source: 'manual' });
    // and it must be a valid record
    expect(() => buildPaymentRecord(r)).not.toThrow();
  });

  it('honors an explicit paid-in-cash answer', () => {
    const r = resolveSessionPayment({ ...base, explicitStatus: 'paid', method: 'cash', amount: 190 });
    expect(r).toMatchObject({ status: 'paid', method: 'cash', amount: 190 });
  });

  it('auto-records on-package when covered by an active package and no answer given', () => {
    const r = resolveSessionPayment({ ...base, drawsFromPackage: true, currentRemaining: 3 });
    expect(r.status).toBe('on-package');
    expect(r.method).toBeNull();
  });

  it('records nothing when the package is exhausted (remaining 0) and no answer', () => {
    expect(resolveSessionPayment({ ...base, drawsFromPackage: true, currentRemaining: 0 })).toBeNull();
  });

  it('records nothing for a non-package session with no answer (leaves it unknown for the owed pool)', () => {
    expect(resolveSessionPayment({ ...base, drawsFromPackage: false, currentRemaining: 0 })).toBeNull();
  });

  it('an explicit answer wins even when a package could cover it', () => {
    const r = resolveSessionPayment({ ...base, explicitStatus: 'comped', drawsFromPackage: true, currentRemaining: 5 });
    expect(r.status).toBe('comped');
  });
});

describe('KV I/O', () => {
  it('writes a record and reads it back', async () => {
    const kv = mockKv();
    const rec = buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'comped', note: 'comp', at: 't' });
    const key = await writePaymentRecord(kv, rec);
    expect(key).toBe('payment:c1:a1');
    const back = await readPaymentRecord(kv, 'c1', 'a1');
    expect(back.status).toBe('comped');
    expect(back.note).toBe('comp');
  });
  it('readPaymentRecord returns null when absent', async () => {
    const kv = mockKv();
    expect(await readPaymentRecord(kv, 'c1', 'nope')).toBeNull();
  });
  it('readPaymentRecord returns null (never throws) on a KV error', async () => {
    const kv = { async get() { throw new Error('boom'); } };
    expect(await readPaymentRecord(kv, 'c1', 'a1')).toBeNull();
  });
  it('listPaymentRecordsForContact returns a map keyed by appointmentId, scoped to the contact', async () => {
    const kv = mockKv();
    await writePaymentRecord(kv, buildPaymentRecord({ contactId: 'c1', appointmentId: 'a1', status: 'paid' }));
    await writePaymentRecord(kv, buildPaymentRecord({ contactId: 'c1', appointmentId: 'a2', status: 'comped' }));
    await writePaymentRecord(kv, buildPaymentRecord({ contactId: 'c2', appointmentId: 'a3', status: 'paid' }));
    const map = await listPaymentRecordsForContact(kv, 'c1');
    expect(Object.keys(map).sort()).toEqual(['a1', 'a2']);
    expect(map.a2.status).toBe('comped');
  });
});
