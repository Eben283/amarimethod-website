import { describe, it, expect } from 'vitest';
import { reserveAuthSlot, RATE_LIMITS } from './rate-limit.js';

// Minimal in-memory KV stub matching the subset reserveAuthSlot uses.
function makeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
  };
}
const args = (over = {}) => ({ ip: '1.2.3.4', email: 'a@b.com', scope: 'portal', dateKey: '2026-06-04', ...over });

describe('reserveAuthSlot', () => {
  it('allows + reserves on a clean slot (writes cooldown, ip, global keys)', async () => {
    const kv = makeKv();
    const r = await reserveAuthSlot(kv, args());
    expect(r.ok).toBe(true);
    expect(kv.store.get('cooldown:portal:a@b.com')).toBe('1');
    expect(kv.store.get('rl:ip:portal:1.2.3.4')).toBe('1');
    expect(kv.store.get('rl:global:portal:2026-06-04')).toBe('1');
  });

  it('blocks a second request for the same email (cooldown hit) with 429', async () => {
    const kv = makeKv({ 'cooldown:portal:a@b.com': '1' });
    const r = await reserveAuthSlot(kv, args());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });

  it('blocks when the per-IP window cap is reached', async () => {
    const kv = makeKv({ 'rl:ip:portal:1.2.3.4': String(RATE_LIMITS.IP_MAX_PER_WINDOW) });
    const r = await reserveAuthSlot(kv, args());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });

  it('allows just under the per-IP cap and bumps the counter', async () => {
    const kv = makeKv({ 'rl:ip:portal:1.2.3.4': String(RATE_LIMITS.IP_MAX_PER_WINDOW - 1) });
    const r = await reserveAuthSlot(kv, args());
    expect(r.ok).toBe(true);
    expect(kv.store.get('rl:ip:portal:1.2.3.4')).toBe(String(RATE_LIMITS.IP_MAX_PER_WINDOW));
  });

  it('blocks when the global daily ceiling is reached', async () => {
    const kv = makeKv({ 'rl:global:portal:2026-06-04': String(RATE_LIMITS.GLOBAL_MAX_PER_DAY) });
    const r = await reserveAuthSlot(kv, args());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });

  it('email cooldown takes precedence over (does not consume) ip/global budget', async () => {
    const kv = makeKv({ 'cooldown:portal:a@b.com': '1', 'rl:ip:portal:1.2.3.4': '3' });
    const r = await reserveAuthSlot(kv, args());
    expect(r.ok).toBe(false);
    expect(kv.store.get('rl:ip:portal:1.2.3.4')).toBe('3'); // unchanged
  });

  it('namespaces by scope — partner and portal budgets are independent', async () => {
    const kv = makeKv({ 'cooldown:portal:a@b.com': '1' });
    const r = await reserveAuthSlot(kv, args({ scope: 'partner' }));
    expect(r.ok).toBe(true); // portal cooldown does not block the partner scope
    expect(kv.store.get('cooldown:partner:a@b.com')).toBe('1');
  });

  it('fails OPEN (allows) but flags degraded when KV is missing', async () => {
    const r = await reserveAuthSlot(null, args());
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it('fails OPEN (allows) but flags degraded when KV throws', async () => {
    const kv = { async get() { throw new Error('kv down'); }, async put() {} };
    const r = await reserveAuthSlot(kv, args());
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
  });
});
