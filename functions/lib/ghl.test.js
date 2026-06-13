import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ghlFetch } from './ghl.js';

// No PORTAL_KV → getGhlToken returns the static GHL_API_KEY with no network,
// so these tests exercise ONLY the retry policy in ghlFetch.
const ctx = { env: { GHL_API_KEY: 'test-key' } };

const resp = (status) => ({ status, headers: { get: () => null } });

function fakeFetch(responses) {
  let i = 0;
  const calls = [];
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url, method: (opts?.method || 'GET') });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r;
  });
  fn.calls = calls;
  return fn;
}

describe('ghlFetch retry policy (idempotency-aware)', () => {
  beforeEach(() => {
    // Make backoff instant so the exponential waits don't slow the suite.
    vi.stubGlobal('setTimeout', (cb) => { cb(); return 0; });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT retry a POST on 5xx (write may have already committed)', async () => {
    const f = fakeFetch([resp(500), resp(200)]);
    vi.stubGlobal('fetch', f);
    const r = await ghlFetch(ctx, 'https://api/x', { method: 'POST' });
    expect(r.status).toBe(500);
    expect(f.calls).toHaveLength(1); // no retry — surfaced to caller
  });

  it('DOES retry a POST on 429 (rejected before processing → safe)', async () => {
    const f = fakeFetch([resp(429), resp(200)]);
    vi.stubGlobal('fetch', f);
    const r = await ghlFetch(ctx, 'https://api/x', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(f.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('retries a GET on 5xx (idempotent)', async () => {
    const f = fakeFetch([resp(503), resp(200)]);
    vi.stubGlobal('fetch', f);
    const r = await ghlFetch(ctx, 'https://api/x'); // method defaults to GET
    expect(r.status).toBe(200);
    expect(f.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('retries a PUT on 5xx (idempotent)', async () => {
    const f = fakeFetch([resp(500), resp(200)]);
    vi.stubGlobal('fetch', f);
    const r = await ghlFetch(ctx, 'https://api/x', { method: 'PUT' });
    expect(r.status).toBe(200);
  });

  it('does NOT retry a PATCH on 5xx (non-idempotent)', async () => {
    const f = fakeFetch([resp(502), resp(200)]);
    vi.stubGlobal('fetch', f);
    const r = await ghlFetch(ctx, 'https://api/x', { method: 'PATCH' });
    expect(r.status).toBe(502);
    expect(f.calls).toHaveLength(1);
  });

  it('returns immediately on a 2xx without retrying', async () => {
    const f = fakeFetch([resp(200)]);
    vi.stubGlobal('fetch', f);
    const r = await ghlFetch(ctx, 'https://api/x', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(f.calls).toHaveLength(1);
  });
});
