import { describe, it, expect } from 'vitest';
import {
  reserveAuthSlot,
  RATE_LIMITS,
  checkPinAttempts,
  recordFailedPinAttempt,
  clearPinAttempts,
  PIN_RATE_LIMITS,
} from './rate-limit.js';

// Minimal in-memory KV stub matching the subset these helpers use.
function makeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
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

describe('checkPinAttempts (PIN brute-force guard)', () => {
  const pinArgs = (over = {}) => ({ ip: '9.9.9.9', scope: 'staff', ...over });

  it('allows on a clean IP and reports the current count', async () => {
    const r = await checkPinAttempts(makeKv(), pinArgs());
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
  });

  it('blocks with 429 once the per-IP attempt cap is reached', async () => {
    const kv = makeKv({ 'rl:pin:staff:9.9.9.9': String(PIN_RATE_LIMITS.IP_MAX_ATTEMPTS) });
    const r = await checkPinAttempts(kv, pinArgs());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });

  it('namespaces by scope — a staff lockout does not block cos', async () => {
    const kv = makeKv({ 'rl:pin:staff:9.9.9.9': String(PIN_RATE_LIMITS.IP_MAX_ATTEMPTS) });
    const r = await checkPinAttempts(kv, pinArgs({ scope: 'cos' }));
    expect(r.ok).toBe(true);
  });

  it('fails CLOSED when KV is missing so a short PIN cannot be brute-forced', async () => {
    const r = await checkPinAttempts(null, pinArgs());
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it('fails CLOSED when KV throws', async () => {
    const kv = { async get() { throw new Error('kv down'); } };
    const r = await checkPinAttempts(kv, pinArgs());
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
});

describe('recordFailedPinAttempt + clearPinAttempts', () => {
  it('increments the per-IP counter on a failed attempt', async () => {
    const kv = makeKv({ 'rl:pin:staff:9.9.9.9': '3' });
    await recordFailedPinAttempt(kv, { ip: '9.9.9.9', scope: 'staff', count: 3 });
    expect(kv.store.get('rl:pin:staff:9.9.9.9')).toBe('4');
  });

  it('clears the per-IP counter on success', async () => {
    const kv = makeKv({ 'rl:pin:staff:9.9.9.9': '7' });
    await clearPinAttempts(kv, { ip: '9.9.9.9', scope: 'staff' });
    expect(kv.store.has('rl:pin:staff:9.9.9.9')).toBe(false);
  });

  // The brute-force loop: the first IP_MAX_ATTEMPTS wrong guesses pass through to
  // a PIN check, then the IP is locked out — turning 10,000 instant guesses into
  // ~10 per 15-minute window per IP.
  it('locks the IP out after IP_MAX_ATTEMPTS wrong attempts', async () => {
    const kv = makeKv();
    for (let i = 0; i < PIN_RATE_LIMITS.IP_MAX_ATTEMPTS; i++) {
      const gate = await checkPinAttempts(kv, { ip: '9.9.9.9', scope: 'staff' });
      expect(gate.ok).toBe(true);
      await recordFailedPinAttempt(kv, { ip: '9.9.9.9', scope: 'staff', count: gate.count });
    }
    const blocked = await checkPinAttempts(kv, { ip: '9.9.9.9', scope: 'staff' });
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(429);
  });

  it('a successful login resets the counter so the next wrong guess starts from zero', async () => {
    const kv = makeKv({ 'rl:pin:staff:9.9.9.9': '9' });
    await clearPinAttempts(kv, { ip: '9.9.9.9', scope: 'staff' });
    const gate = await checkPinAttempts(kv, { ip: '9.9.9.9', scope: 'staff' });
    expect(gate.ok).toBe(true);
    expect(gate.count).toBe(0);
  });
});
