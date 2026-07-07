import { describe, it, expect, vi } from 'vitest';

// Real requireStaffAuth runs unmocked; only the JWT verification underneath is
// stubbed (same approach as staff-reply-dismiss.test.js — catches wrong-arity
// auth-call bugs where context.env would resolve against the bare Request).
vi.mock('../lib/auth.js', () => ({ verifySessionToken: vi.fn(async () => ({ role: 'staff', email: 'garrett@x.com' })) }));

import { onRequestGet, onRequestPost, normalizeRecord } from './staff-elbow-study.js';

function makeKv(initial = {}) {
  const store = { ...initial };
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

function postCtx({ env = {}, headers = {}, body = {} } = {}) {
  return {
    request: new Request('https://www.amarimethod.com/api/staff-elbow-study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env: { JWT_SECRET: 'jwt', ...env },
  };
}

function getCtx({ env = {}, headers = {}, contactId } = {}) {
  const url = new URL('https://www.amarimethod.com/api/staff-elbow-study');
  if (contactId !== undefined) url.searchParams.set('contactId', contactId);
  return {
    request: new Request(url.toString(), { method: 'GET', headers: { ...headers } }),
    env: { JWT_SECRET: 'jwt', ...env },
  };
}

const AUTH = { Authorization: 'Bearer valid' };

describe('normalizeRecord — strict server-side validation, immutable output', () => {
  const now = '2026-07-07T12:00:00.000Z';

  it('always produces exactly 3 sessions', () => {
    expect(normalizeRecord({}, now).sessions).toHaveLength(3);
    expect(normalizeRecord({ sessions: [{ before: 5 }] }, now).sessions).toHaveLength(3);
    expect(normalizeRecord({ sessions: [{}, {}, {}, {}, {}] }, now).sessions).toHaveLength(3);
  });

  it('clamps pain to integers in [0,10], else null', () => {
    const r = normalizeRecord({ sessions: [{ before: 7, after: 2 }, { before: 11, after: -1 }, { before: '4.6', after: 'x' }] }, now);
    expect(r.sessions[0]).toMatchObject({ before: 7, after: 2 });
    expect(r.sessions[1]).toMatchObject({ before: null, after: null });
    expect(r.sessions[2]).toMatchObject({ before: 5, after: null });
  });

  it('validates arm against the enum', () => {
    expect(normalizeRecord({ arm: 'left' }, now).arm).toBe('left');
    expect(normalizeRecord({ arm: 'sideways' }, now).arm).toBe(null);
    expect(normalizeRecord({}, now).arm).toBe(null);
  });

  it('coerces painWeeks and caps free text', () => {
    expect(normalizeRecord({ painWeeks: '3' }, now).painWeeks).toBe(3);
    expect(normalizeRecord({ painWeeks: 99999 }, now).painWeeks).toBe(null);
    expect(normalizeRecord({ gameImpact: 'x'.repeat(5000) }, now).gameImpact).toHaveLength(1000);
  });

  it('stamps `at` when a session has data and none was supplied', () => {
    const r = normalizeRecord({ sessions: [{ before: 8 }, {}, {}] }, now);
    expect(r.sessions[0].at).toBe(now);
    expect(r.sessions[1].at).toBe(null);
  });

  it('does not mutate the input object', () => {
    const input = { arm: 'left', sessions: [{ before: 5 }] };
    const snapshot = JSON.stringify(input);
    normalizeRecord(input, now);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('defaults baseline and final to empty survey snapshots', () => {
    const r = normalizeRecord({}, now);
    expect(r.baseline).toEqual({ responses: {}, at: null });
    expect(r.final).toEqual({ responses: {}, at: null });
  });

  it('keeps valid 0-10 survey responses and drops invalid ones', () => {
    const r = normalizeRecord({
      baseline: { responses: { p1: 7, p2: '3', p3: 11, p4: -1, p5: 'x', 's1': 0 } },
    }, now);
    // p1 kept, p2 coerced, p3/p4 out of range dropped, p5 non-numeric dropped, s1 kept
    expect(r.baseline.responses).toEqual({ p1: 7, p2: 3, s1: 0 });
  });

  it('drops survey keys that are not id-shaped and caps item count', () => {
    const bad = { 'p 1': 5, 'a;b': 5, ['x'.repeat(20)]: 5 };
    const many = {};
    for (let i = 0; i < 60; i++) many[`i${i}`] = 5;
    expect(normalizeRecord({ baseline: { responses: bad } }, now).baseline.responses).toEqual({});
    expect(Object.keys(normalizeRecord({ final: { responses: many } }, now).final.responses).length).toBeLessThanOrEqual(40);
  });

  it('stamps survey `at` when responses exist and none was supplied', () => {
    const r = normalizeRecord({ baseline: { responses: { p1: 4 } }, final: { responses: {} } }, now);
    expect(r.baseline.at).toBe(now);
    expect(r.final.at).toBe(null);
  });
});

describe('staff-elbow-study endpoint', () => {
  it('POST writes a normalized record to KV and echoes it back', async () => {
    const kv = makeKv();
    const res = await onRequestPost(postCtx({
      env: { PORTAL_KV: kv },
      headers: AUTH,
      body: { contactId: 'c1', record: { arm: 'right', painWeeks: 4, gameImpact: 'Backhand hurts.', sessions: [{ before: 7, after: 3 }, {}, {}] } },
    }));
    expect(res.status).toBe(200);
    const saved = JSON.parse(kv._store['elbow_study:c1']);
    expect(saved.arm).toBe('right');
    expect(saved.sessions[0]).toMatchObject({ before: 7, after: 3 });
    expect(saved.sessions).toHaveLength(3);
  });

  it('POST 400s without contactId', async () => {
    const res = await onRequestPost(postCtx({ env: { PORTAL_KV: makeKv() }, headers: AUTH, body: { record: {} } }));
    expect(res.status).toBe(400);
  });

  it('POST 401s without an Authorization header', async () => {
    const res = await onRequestPost(postCtx({ env: { PORTAL_KV: makeKv() }, body: { contactId: 'c1', record: {} } }));
    expect(res.status).toBe(401);
  });

  it('GET returns the stored record', async () => {
    const kv = makeKv({ 'elbow_study:c1': JSON.stringify({ arm: 'left', sessions: [] }) });
    const res = await onRequestGet(getCtx({ env: { PORTAL_KV: kv }, headers: AUTH, contactId: 'c1' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.record.arm).toBe('left');
  });

  it('GET returns record:null when nothing captured yet', async () => {
    const res = await onRequestGet(getCtx({ env: { PORTAL_KV: makeKv() }, headers: AUTH, contactId: 'nope' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.record).toBe(null);
  });

  it('GET 400s without contactId', async () => {
    const res = await onRequestGet(getCtx({ env: { PORTAL_KV: makeKv() }, headers: AUTH }));
    expect(res.status).toBe(400);
  });
});
