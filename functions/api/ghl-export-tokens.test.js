import { describe, it, expect } from 'vitest';
import { onRequestGet } from './ghl-export-tokens.js';

// N2 (2026-06-11 review): this endpoint exports full GHL access+refresh tokens
// (effectively full CRM access). It was guarded only by a query-string secret
// (?secret=) with a non-constant-time compare — the secret leaks into CDN/proxy
// logs, referrers, and browser history. Hardened to: OFF by default (404 unless
// GHL_TOKEN_EXPORT_ENABLED==="true") + Authorization: Bearer header only.

const SECRET = 'setup-secret-xyz';
const KV = {
  get: async (k) => ({ ghl_access_token: 'AT', ghl_refresh_token: 'RT', ghl_token_expiry: '1750000000000' }[k] ?? null),
};
const ctx = (env, headers = {}, qs = '') => ({
  request: new Request(`https://www.amarimethod.com/api/ghl-export-tokens${qs}`, { headers }),
  env: { PORTAL_KV: KV, ...env },
});
const ENABLED = { GHL_TOKEN_EXPORT_ENABLED: 'true', GHL_OAUTH_SETUP_SECRET: SECRET };

describe('ghl-export-tokens (N2 hardening)', () => {
  it('404s when the export flag is not enabled — even with a correct header (off by default)', async () => {
    const res = await onRequestGet(ctx({ GHL_OAUTH_SETUP_SECRET: SECRET }, { Authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(404);
  });

  it('401s when enabled but no Authorization header', async () => {
    const res = await onRequestGet(ctx(ENABLED));
    expect(res.status).toBe(401);
  });

  it('401s on a wrong bearer token', async () => {
    const res = await onRequestGet(ctx(ENABLED, { Authorization: 'Bearer nope' }));
    expect(res.status).toBe(401);
  });

  it('no longer accepts the query-string secret (the leaky old path)', async () => {
    const res = await onRequestGet(ctx(ENABLED, {}, `?secret=${SECRET}`));
    expect(res.status).toBe(401);
  });

  it('returns tokens with a correct Bearer header when enabled', async () => {
    const res = await onRequestGet(ctx(ENABLED, { Authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe('AT');
    expect(body.refresh_token).toBe('RT');
  });
});
