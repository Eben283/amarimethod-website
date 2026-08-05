import { describe, it, expect, vi } from 'vitest';
import { onRequestGet } from './comms-summary.js';

function makeKv(store = {}) {
  return {
    get: vi.fn(async (key, type) => {
      const v = store[key];
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    }),
  };
}

function ctx({ env = {}, headers = {} } = {}) {
  return {
    request: new Request('https://www.amarimethod.com/api/comms-summary', { headers }),
    env,
  };
}

describe('GET /api/comms-summary', () => {
  it('returns the cached comms-coherence summary from KV', async () => {
    const summary = { date: '2026-07-01', count: 2, items: [{ contactId: 'c1', topFlag: 'redundant-channel' }] };
    const kv = makeKv({ 'comms:flags:summary': JSON.stringify(summary) });
    const res = await onRequestGet(ctx({
      env: { PORTAL_KV: kv, OPS_READ_KEY: 'secret' },
      headers: { 'X-Service-Key': 'secret' },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
  });

  it('404s when no summary has been written yet', async () => {
    const res = await onRequestGet(ctx({
      env: { PORTAL_KV: makeKv(), OPS_READ_KEY: 'secret' },
      headers: { 'X-Service-Key': 'secret' },
    }));
    expect(res.status).toBe(404);
  });

  it('401s when OPS_READ_KEY is configured but not presented', async () => {
    const res = await onRequestGet(ctx({ env: { PORTAL_KV: makeKv(), OPS_READ_KEY: 'secret' } }));
    expect(res.status).toBe(401);
  });

  it('500s when OPS_READ_KEY is not configured (fail closed, before the KV check)', async () => {
    const res = await onRequestGet(ctx({ env: {} }));
    expect(res.status).toBe(500);
  });

  it('500s when authorized but PORTAL_KV is not bound', async () => {
    const res = await onRequestGet(ctx({
      env: { OPS_READ_KEY: 'secret' },
      headers: { 'X-Service-Key': 'secret' },
    }));
    expect(res.status).toBe(500);
  });
});
