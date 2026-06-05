import { describe, it, expect } from 'vitest';
import { isContactRevoked, revokeKey } from './session-guard.js';

function makeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
  };
}

describe('revokeKey', () => {
  it('namespaces by contactId', () => {
    expect(revokeKey('abc')).toBe('auth-revoked:abc');
  });
});

describe('isContactRevoked', () => {
  it('false for a contact with no revoke flag', async () => {
    expect(await isContactRevoked(makeKv(), 'C1')).toBe(false);
  });
  it('true when the revoke flag is set', async () => {
    const kv = makeKv({ 'auth-revoked:C1': '1' });
    expect(await isContactRevoked(kv, 'C1')).toBe(true);
  });
  it('only revokes the named contact, not others', async () => {
    const kv = makeKv({ 'auth-revoked:C1': '1' });
    expect(await isContactRevoked(kv, 'C2')).toBe(false);
  });
  it('false (no crash) when kv or contactId is missing', async () => {
    expect(await isContactRevoked(null, 'C1')).toBe(false);
    expect(await isContactRevoked(makeKv(), '')).toBe(false);
  });
  it('fails open (false) when KV throws', async () => {
    const kv = { async get() { throw new Error('kv down'); } };
    expect(await isContactRevoked(kv, 'C1')).toBe(false);
  });
});
