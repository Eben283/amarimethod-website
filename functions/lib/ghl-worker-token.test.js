import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAccessToken } from './ghl-worker-token.js';

afterEach(() => vi.unstubAllGlobals());

function makeEnv(seed = {}) {
  const store = { ...seed };
  return {
    store,
    GHL_CLIENT_ID: 'client-id',
    GHL_CLIENT_SECRET: 'client-secret',
    PORTAL_KV: {
      get: vi.fn(async (k) => (k in store ? store[k] : null)),
      put: vi.fn(async (k, v) => { store[k] = v; }),
    },
  };
}

describe('getAccessToken', () => {
  it('returns the cached token when it has more than the 5-min refresh buffer left', async () => {
    const env = makeEnv({
      ghl_access_token: 'cached-token',
      ghl_token_expiry: String(Date.now() + 3_600_000), // 1h left
    });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not call fetch'); }));

    const token = await getAccessToken(env);

    expect(token).toBe('cached-token');
  });

  it('refreshes when the cached token is within the 5-min buffer of expiry', async () => {
    const env = makeEnv({
      ghl_access_token: 'stale-token',
      ghl_refresh_token: 'refresh-1',
      ghl_token_expiry: String(Date.now() + 60_000), // 1 min left — inside the 5-min buffer
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-2', expires_in: 86399 }),
    })));

    const token = await getAccessToken(env);

    expect(token).toBe('fresh-token');
    expect(env.store.ghl_access_token).toBe('fresh-token');
    expect(env.store.ghl_refresh_token).toBe('refresh-2');
  });

  it('refreshes when no token is cached at all', async () => {
    const env = makeEnv({ ghl_refresh_token: 'refresh-1' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'first-token', refresh_token: 'refresh-2', expires_in: 86399 }),
    })));

    const token = await getAccessToken(env);

    expect(token).toBe('first-token');
  });

  it('keeps the OLD refresh token in KV when GHL does not return a new one', async () => {
    const env = makeEnv({ ghl_refresh_token: 'refresh-keep-me' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'fresh-token', expires_in: 86399 }), // no refresh_token in response
    })));

    await getAccessToken(env);

    expect(env.store.ghl_refresh_token).toBe('refresh-keep-me');
  });

  it('throws when there is no refresh token to fall back on', async () => {
    const env = makeEnv({}); // no ghl_refresh_token at all
    await expect(getAccessToken(env)).rejects.toThrow(/No refresh token/);
  });

  it('throws when GHL_CLIENT_ID/SECRET are missing', async () => {
    const env = makeEnv({ ghl_refresh_token: 'refresh-1' });
    delete env.GHL_CLIENT_ID;
    await expect(getAccessToken(env)).rejects.toThrow(/Missing GHL_CLIENT_ID/);
  });

  it('throws when PORTAL_KV binding is not available', async () => {
    const env = { GHL_CLIENT_ID: 'x', GHL_CLIENT_SECRET: 'y' };
    await expect(getAccessToken(env)).rejects.toThrow(/PORTAL_KV binding not available/);
  });

  it('throws with the GHL error status when the refresh request itself fails', async () => {
    const env = makeEnv({ ghl_refresh_token: 'refresh-1' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(getAccessToken(env)).rejects.toThrow(/Token refresh failed: 401/);
  });
});
