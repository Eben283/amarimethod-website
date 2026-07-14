import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/auth.js', () => ({
  verifySessionToken: vi.fn(async () => ({ role: 'staff', email: 'garrett@x.com' })),
}));

import { onRequestGet, onRequestPost, normalizeRecord } from './staff-study.js';
import { kvKey } from '../lib/study-capture.js';

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
    request: new Request('https://www.amarimethod.com/api/staff-study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env: { JWT_SECRET: 'jwt', ...env },
  };
}

function getCtx({ env = {}, headers = {}, contactId, studySlug } = {}) {
  const url = new URL('https://www.amarimethod.com/api/staff-study');
  if (contactId !== undefined) url.searchParams.set('contactId', contactId);
  if (studySlug !== undefined) url.searchParams.set('studySlug', studySlug);
  return {
    request: new Request(url.toString(), { method: 'GET', headers: { ...headers } }),
    env: { JWT_SECRET: 'jwt', ...env },
  };
}

const AUTH = { Authorization: 'Bearer valid' };

describe('kvKey — elbow keeps legacy key, others use study:slug:id', () => {
  it('maps tennis-elbow to elbow_study:{id}', () => {
    expect(kvKey('tennis-elbow', 'c1')).toBe('elbow_study:c1');
  });
  it('maps other studies to study:{slug}:{id}', () => {
    expect(kvKey('tmj', 'c1')).toBe('study:tmj:c1');
    expect(kvKey('runners-lower-leg', 'c1')).toBe('study:runners-lower-leg:c1');
    expect(kvKey('hand', 'c1')).toBe('study:hand:c1');
  });
});

describe('normalizeRecord — accepts bodyPart alias', () => {
  const now = '2026-07-13T12:00:00.000Z';
  it('reads bodyPart into arm', () => {
    expect(normalizeRecord({ bodyPart: 'left' }, now).arm).toBe('left');
  });
  it('reads activityImpact into gameImpact', () => {
    expect(normalizeRecord({ activityImpact: 'hurts to climb' }, now).gameImpact).toBe('hurts to climb');
  });
});

describe('staff-study endpoint', () => {
  it('POST writes jaw capture under study:tmj:{id}', async () => {
    const kv = makeKv();
    const res = await onRequestPost(postCtx({
      env: { PORTAL_KV: kv },
      headers: AUTH,
      body: {
        contactId: 'c1',
        studySlug: 'tmj',
        record: { bodyPart: 'left', painWeeks: 8, sessions: [{ before: 6, after: 2 }, {}, {}] },
      },
    }));
    expect(res.status).toBe(200);
    const saved = JSON.parse(kv._store['study:tmj:c1']);
    expect(saved.arm).toBe('left');
    expect(saved.sessions[0]).toMatchObject({ before: 6, after: 2 });
    expect(kv._store['elbow_study:c1']).toBeUndefined();
  });

  it('POST writes foot and hand under their own keys', async () => {
    const kv = makeKv();
    for (const slug of ['runners-lower-leg', 'hand']) {
      const res = await onRequestPost(postCtx({
        env: { PORTAL_KV: kv },
        headers: AUTH,
        body: { contactId: 'c9', studySlug: slug, record: { sessions: [{ before: 5, after: 1 }, {}, {}] } },
      }));
      expect(res.status).toBe(200);
      expect(kv._store[`study:${slug}:c9`]).toBeTruthy();
    }
  });

  it('POST for tennis-elbow still uses elbow_study key', async () => {
    const kv = makeKv();
    const res = await onRequestPost(postCtx({
      env: { PORTAL_KV: kv },
      headers: AUTH,
      body: { contactId: 'c1', studySlug: 'tennis-elbow', record: { arm: 'right' } },
    }));
    expect(res.status).toBe(200);
    expect(kv._store['elbow_study:c1']).toBeTruthy();
  });

  it('POST 400s without studySlug or with unknown slug', async () => {
    const kv = makeKv();
    expect((await onRequestPost(postCtx({
      env: { PORTAL_KV: kv }, headers: AUTH, body: { contactId: 'c1', record: {} },
    }))).status).toBe(400);
    expect((await onRequestPost(postCtx({
      env: { PORTAL_KV: kv }, headers: AUTH, body: { contactId: 'c1', studySlug: 'nope', record: {} },
    }))).status).toBe(400);
  });

  it('GET returns the stored record for that study', async () => {
    const kv = makeKv({ 'study:hand:c1': JSON.stringify({ arm: 'both', sessions: [] }) });
    const res = await onRequestGet(getCtx({
      env: { PORTAL_KV: kv }, headers: AUTH, contactId: 'c1', studySlug: 'hand',
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.record.arm).toBe('both');
  });

  it('GET 400s without studySlug', async () => {
    const res = await onRequestGet(getCtx({
      env: { PORTAL_KV: makeKv() }, headers: AUTH, contactId: 'c1',
    }));
    expect(res.status).toBe(400);
  });

  it('GET returns record:null when nothing captured yet', async () => {
    const res = await onRequestGet(getCtx({
      env: { PORTAL_KV: makeKv() }, headers: AUTH, contactId: 'nope', studySlug: 'tmj',
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).record).toBe(null);
  });
});
