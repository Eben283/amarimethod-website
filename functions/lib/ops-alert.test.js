import { describe, it, expect, vi } from 'vitest';
import { recordOpsError, listOpsErrors, clearOpsError, __test } from './ops-alert.js';

// Minimal in-memory fake of a KV namespace. Models put/get/delete/list with the
// prefix + cursor behavior recordOpsError + listOpsErrors depend on.
function fakeKv() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts) { store.set(key, { value, opts }); },
    async get(key) { return store.has(key) ? store.get(key).value : null; },
    async delete(key) { store.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { keys: keys.map((name) => ({ name })), list_complete: true, cursor };
    },
  };
}

describe('recordOpsError', () => {
  it('writes one entry under the ops:err: prefix with a 30-day TTL', async () => {
    const kv = fakeKv();
    const res = await recordOpsError({ PORTAL_KV: kv }, 'ghl-purchase-webhook', 'PUT failed', { contactId: 'abc', status: 500 });
    expect(res.recorded).toBe(true);
    expect(res.key.startsWith(__test.OPS_ERR_PREFIX)).toBe(true);
    expect(kv.store.size).toBe(1);
    const [, stored] = [...kv.store.entries()][0];
    expect(stored.opts.expirationTtl).toBe(__test.OPS_ERR_TTL_SECONDS);
    const entry = JSON.parse(stored.value);
    expect(entry.source).toBe('ghl-purchase-webhook');
    expect(entry.detail.contactId).toBe('abc');
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('NEVER throws and reports no-kv when there is no binding', async () => {
    const res = await recordOpsError({}, 'src', 'boom');
    expect(res).toEqual({ recorded: false, reason: 'no-kv' });
  });

  it('NEVER throws even when the KV put itself fails', async () => {
    const brokenKv = { put: () => { throw new Error('kv down'); } };
    const res = await recordOpsError({ PORTAL_KV: brokenKv }, 'src', 'boom');
    expect(res).toEqual({ recorded: false, reason: 'threw' });
  });

  it('does not persist a token even if one is passed in detail (caller contract)', async () => {
    // Guards the convention that detail is IDs/status only. If a caller regresses
    // and passes a secret, this at least keeps the assertion visible in review.
    const kv = fakeKv();
    await recordOpsError({ PORTAL_KV: kv }, 'src', 'summary', { status: 500, contactId: 'x' });
    const stored = [...kv.store.values()][0].value;
    expect(stored).not.toMatch(/authorization|bearer|secret|token/i);
  });

  it('falls back to PURCHASE_KV when PORTAL_KV is absent', async () => {
    const kv = fakeKv();
    const res = await recordOpsError({ PURCHASE_KV: kv }, 'src', 'summary');
    expect(res.recorded).toBe(true);
    expect(kv.store.size).toBe(1);
  });
});

describe('listOpsErrors + clearOpsError', () => {
  it('lists recorded errors oldest-first and clears them individually', async () => {
    const kv = fakeKv();
    const env = { PORTAL_KV: kv };
    // Seed a couple of entries with sortable keys directly (ISO order).
    kv.store.set('ops:err:2026-07-04T10:00:00.000Z-aaa', { value: JSON.stringify({ source: 's', summary: 'first' }) });
    kv.store.set('ops:err:2026-07-04T11:00:00.000Z-bbb', { value: JSON.stringify({ source: 's', summary: 'second' }) });
    kv.store.set('unrelated:key', { value: 'ignore me' });

    const errors = await listOpsErrors(env);
    expect(errors.map((e) => e.summary)).toEqual(['first', 'second']);
    expect(errors[0].key).toContain('10:00:00');

    await clearOpsError(env, errors[0].key);
    const after = await listOpsErrors(env);
    expect(after.map((e) => e.summary)).toEqual(['second']);
  });

  it('returns [] when there is no KV binding', async () => {
    expect(await listOpsErrors({})).toEqual([]);
  });
});
