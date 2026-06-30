import { describe, it, expect, vi } from 'vitest';

// Real requireStaffAuth from endpoint-guards.js runs unmocked — only the JWT
// verification underneath it is stubbed. This is what catches the actual bug:
// staff-reply-dismiss.js called requireStaffAuth(request, env, headers) instead
// of requireStaffAuth(context, headers), so `context.env.JWT_SECRET` resolved
// against the bare Request object (no .env) and always 500'd, regardless of
// whether the caller's token was valid. Every "No reply needed" click silently
// failed to persist from 2026-06-28 (when this endpoint shipped) until fixed.
vi.mock('../lib/auth.js', () => ({ verifySessionToken: vi.fn(async () => ({ role: 'staff', email: 'garrett@x.com' })) }));

import { onRequestPost } from './staff-reply-dismiss.js';

function makeKv(initial = {}) {
  const store = { 'reply:dismissed': JSON.stringify(initial) };
  return {
    get: vi.fn(async (key, type) => {
      const v = store[key];
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    }),
    put: vi.fn(async (key, value) => { store[key] = value; }),
    _store: store,
  };
}

function ctx({ env = {}, headers = {}, body = {} } = {}) {
  return {
    request: new Request('https://www.amarimethod.com/api/staff-reply-dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env: { JWT_SECRET: 'jwt', ...env },
  };
}

describe('staff-reply-dismiss — persists "No reply needed" past a wrong-arity auth bug', () => {
  it('returns 200 (not 500) for a valid staff token, and writes the dismissal to KV', async () => {
    const kv = makeKv();
    const res = await onRequestPost(ctx({
      env: { PORTAL_KV: kv },
      headers: { Authorization: 'Bearer valid' },
      body: { contactId: 'c1', lastMessageDate: '2026-06-28T10:00:00Z' },
    }));
    expect(res.status).toBe(200);
    const saved = JSON.parse(kv._store['reply:dismissed']);
    expect(saved.c1).toBe('2026-06-28T10:00:00Z');
  });

  it('401s without an Authorization header (auth guard still runs)', async () => {
    const res = await onRequestPost(ctx({ env: { PORTAL_KV: makeKv() }, body: { contactId: 'c1' } }));
    expect(res.status).toBe(401);
  });

  it('400s when contactId is missing', async () => {
    const res = await onRequestPost(ctx({
      env: { PORTAL_KV: makeKv() },
      headers: { Authorization: 'Bearer valid' },
      body: {},
    }));
    expect(res.status).toBe(400);
  });
});
