import { describe, it, expect, afterEach } from 'vitest';
import { requireOwner, loadOwnedContact } from './owned-access.js';

// The ownership gate collapses the per-endpoint auth block that each portal /
// partner endpoint used to inline. The IDOR invariant it must hold: ownership
// comes from the verified JWT (tokenPayload.contactId), NEVER from a request-
// supplied id. A tampered id in the body/query must have zero effect on which
// record is loaded.

const SECRET = 'test-secret';

// Mint a real HMAC-SHA256 token in the exact shape verifySessionToken expects
// (mirrors createSessionToken in portal-verify.js / partner-verify.js).
async function signToken(payload, secret = SECRET) {
  const enc = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${data}.${sig}`;
}

const future = () => Date.now() + 60_000;
const past = () => Date.now() - 60_000;

function makeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
  };
}

// Build a Pages-Function-like context. `body`/`query` model request-supplied
// data the gate must ignore — they are carried on the request but never read
// for ownership.
function makeContext({ secret = SECRET, token, kv, env = {} } = {}) {
  return {
    request: {
      headers: {
        get: (h) => (h === 'Authorization' && token ? `Bearer ${token}` : null),
      },
    },
    env: { JWT_SECRET: secret, GHL_API_KEY: 'ghl-test-key', PORTAL_KV: kv ?? makeKv(), ...env },
  };
}

const HEADERS = { 'Content-Type': 'application/json' };

async function bodyOf(response) {
  return JSON.parse(await response.text());
}

// Capture outbound fetch URLs so IDOR tests can assert which contact was loaded.
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function stubContactFetch(contact, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok, status, json: async () => ({ contact }) };
  };
  return calls;
}

describe('requireOwner', () => {
  it('missing token → 401', async () => {
    const ctx = makeContext({ token: undefined });
    const { error, contactId } = await requireOwner(ctx, HEADERS);
    expect(contactId).toBeUndefined();
    expect(error.status).toBe(401);
    expect((await bodyOf(error)).error).toBe('Not authenticated');
  });

  it('expired token → 401', async () => {
    const token = await signToken({ contactId: 'C1', exp: past() });
    const ctx = makeContext({ token });
    const { error } = await requireOwner(ctx, HEADERS);
    expect(error.status).toBe(401);
    expect((await bodyOf(error)).error).toBe('Session expired. Please log in again.');
  });

  it('missing JWT_SECRET → 500', async () => {
    const token = await signToken({ contactId: 'C1', exp: future() });
    const ctx = makeContext({ token, env: { JWT_SECRET: undefined } });
    const { error } = await requireOwner(ctx, HEADERS);
    expect(error.status).toBe(500);
  });

  it('wrong audience → 403', async () => {
    // A validly-signed client token (no type) hitting a partner-audience gate.
    const token = await signToken({ contactId: 'C1', exp: future() });
    const ctx = makeContext({ token });
    const { error } = await requireOwner(ctx, HEADERS, { audience: 'partner' });
    expect(error.status).toBe(403);
    expect((await bodyOf(error)).error).toBe('This area is for partners.');
  });

  it('revoked contact → 401', async () => {
    const token = await signToken({ contactId: 'C1', exp: future() });
    const ctx = makeContext({ token, kv: makeKv({ 'auth-revoked:C1': '1' }) });
    const { error } = await requireOwner(ctx, HEADERS);
    expect(error.status).toBe(401);
    expect((await bodyOf(error)).error).toBe('Session expired. Please log in again.');
  });

  it('happy path returns the token-derived contactId', async () => {
    const token = await signToken({ contactId: 'C-owner', email: 'a@b.com', exp: future() });
    const ctx = makeContext({ token });
    const { error, tokenPayload, contactId } = await requireOwner(ctx, HEADERS);
    expect(error).toBeUndefined();
    expect(contactId).toBe('C-owner');
    expect(tokenPayload.email).toBe('a@b.com');
  });

  it('honors message overrides (audience wording)', async () => {
    const token = await signToken({ contactId: 'C1', exp: future() });
    const ctx = makeContext({ token });
    const { error } = await requireOwner(ctx, HEADERS, {
      audience: 'partner',
      messages: { wrongAudience: 'Partner access required' },
    });
    expect(error.status).toBe(403);
    expect((await bodyOf(error)).error).toBe('Partner access required');
  });
});

describe('loadOwnedContact', () => {
  it('403 when the required tag is missing', async () => {
    const token = await signToken({ contactId: 'C1', type: 'partner', exp: future() });
    const ctx = makeContext({ token });
    stubContactFetch({ id: 'C1', tags: [] });
    const { error } = await loadOwnedContact(ctx, HEADERS, {
      audience: 'partner',
      requireTag: 'affiliate-partner',
    });
    expect(error.status).toBe(403);
    expect((await bodyOf(error)).error).toBe('Your partner access is no longer active.');
  });

  it('422 when the GHL contact fetch fails', async () => {
    const token = await signToken({ contactId: 'C1', type: 'partner', exp: future() });
    const ctx = makeContext({ token });
    stubContactFetch(null, { ok: false, status: 404 });
    const { error } = await loadOwnedContact(ctx, HEADERS, { audience: 'partner' });
    expect(error.status).toBe(422);
    expect((await bodyOf(error)).error).toBe('Unable to load your data. Please try again.');
  });

  it('happy path returns the owner contact + ghl token + token-derived id', async () => {
    const token = await signToken({ contactId: 'C1', type: 'partner', exp: future() });
    const ctx = makeContext({ token });
    const calls = stubContactFetch({ id: 'C1', tags: ['affiliate-partner'], firstName: 'Sam' });
    const { error, contact, contactId, ghlToken } = await loadOwnedContact(ctx, HEADERS, {
      audience: 'partner',
      requireTag: 'affiliate-partner',
    });
    expect(error).toBeUndefined();
    expect(contactId).toBe('C1');
    expect(contact.firstName).toBe('Sam');
    expect(ghlToken).toBe('ghl-test-key');
    expect(calls[0]).toContain('/contacts/C1');
  });
});

describe('IDOR: request-supplied contactId is ignored — only the token id is loaded', () => {
  it('a tampered contactId in the body/query has NO effect; the token id is what loads, and the other record is never fetched', async () => {
    // Attacker is authenticated as themselves (attacker-1) but stuffs a victim
    // id into every request-controlled surface a naive handler might trust.
    const token = await signToken({ contactId: 'attacker-1', type: 'partner', exp: future() });
    const ctx = makeContext({ token });
    // The request also "carries" ?contactId=victim-9 and { contactId: 'victim-9' }.
    // The gate reads neither — it only ever uses tokenPayload.contactId.
    const calls = stubContactFetch({ id: 'attacker-1', tags: ['affiliate-partner'] });

    const { error, contactId } = await loadOwnedContact(ctx, HEADERS, {
      audience: 'partner',
      requireTag: 'affiliate-partner',
    });

    expect(error).toBeUndefined();
    // The loaded record is the TOKEN's contact, never the request-supplied one.
    expect(contactId).toBe('attacker-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/contacts/attacker-1');
    expect(calls[0]).not.toContain('victim-9');
  });

  it('an attacker reaching for another audience/revoked record gets 403/401, never 200 with the other record', async () => {
    // Client token (no partner audience) aimed at a partner endpoint → 403,
    // and no contact fetch happens at all.
    const clientToken = await signToken({ contactId: 'attacker-1', exp: future() });
    const clientCtx = makeContext({ token: clientToken });
    const clientCalls = stubContactFetch({ id: 'victim-9', tags: ['affiliate-partner'] });
    const audienceDenied = await loadOwnedContact(clientCtx, HEADERS, { audience: 'partner' });
    expect(audienceDenied.error.status).toBe(403);
    expect(audienceDenied.contact).toBeUndefined();
    expect(clientCalls).toHaveLength(0); // never even fetched the victim record

    // Revoked partner token → 401, again no contact returned.
    const revokedToken = await signToken({ contactId: 'attacker-1', type: 'partner', exp: future() });
    const revokedCtx = makeContext({ token: revokedToken, kv: makeKv({ 'auth-revoked:attacker-1': '1' }) });
    const revokedCalls = stubContactFetch({ id: 'victim-9', tags: ['affiliate-partner'] });
    const revokedDenied = await loadOwnedContact(revokedCtx, HEADERS, { audience: 'partner' });
    expect(revokedDenied.error.status).toBe(401);
    expect(revokedDenied.contact).toBeUndefined();
    expect(revokedCalls).toHaveLength(0);
  });
});
