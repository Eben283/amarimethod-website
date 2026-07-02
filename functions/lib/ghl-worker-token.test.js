import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAccessToken, _resetForTests } from './ghl-worker-token.js';

afterEach(() => {
  vi.unstubAllGlobals();
  _resetForTests();
});

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

  it('single-flight: N concurrent callers with a stale token burn exactly ONE refresh', async () => {
    // GHL refresh tokens are single-use — parallel refreshes mean one wins
    // and the rest 4xx (and any of them could orphan the winning rotation).
    // daily-audit fans out 4 parallel GHL fetches per contact, each calling
    // getAccessToken, so this fires in real runs whenever the token is stale.
    const env = makeEnv({
      ghl_access_token: 'stale-token',
      ghl_refresh_token: 'refresh-1',
      ghl_token_expiry: String(Date.now() + 60_000), // inside the 5-min buffer
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-2', expires_in: 86399 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await Promise.all([
      getAccessToken(env),
      getAccessToken(env),
      getAccessToken(env),
      getAccessToken(env),
    ]);

    expect(tokens).toEqual(['fresh-token', 'fresh-token', 'fresh-token', 'fresh-token']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('double-check: does not burn the refresh token when a peer already refreshed in KV', async () => {
    // Another writer (the token-refresh worker, a Pages Function) can land a
    // fresh token between our staleness check and our refresh. Re-reading KV
    // before the POST avoids invalidating THEIR refresh token for nothing.
    const store = {
      ghl_access_token: 'stale-token',
      ghl_refresh_token: 'refresh-1',
      ghl_token_expiry: String(Date.now() + 60_000),
    };
    let reads = 0;
    const env = {
      GHL_CLIENT_ID: 'client-id',
      GHL_CLIENT_SECRET: 'client-secret',
      PORTAL_KV: {
        get: vi.fn(async (k) => {
          reads++;
          // After the first staleness read (2 gets), a peer's refresh lands.
          if (reads === 3) {
            store.ghl_access_token = 'peer-fresh-token';
            store.ghl_token_expiry = String(Date.now() + 86_000_000);
          }
          return k in store ? store[k] : null;
        }),
        put: vi.fn(async (k, v) => { store[k] = v; }),
      },
    };
    const fetchMock = vi.fn(async () => {
      throw new Error('should not refresh — peer already did');
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await getAccessToken(env);

    expect(token).toBe('peer-fresh-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('memo: a sequential call after a refresh does not re-burn the refresh token even when KV serves stale values', async () => {
    // KV reads are colo-cached ~60s: right after our own refresh, the next
    // getAccessToken in the same run can read the PRE-refresh snapshot back.
    // Without the in-memory memo it would take the refresh path again with
    // the already-consumed refresh token → 4xx.
    const staleSnapshot = {
      ghl_access_token: 'stale-token',
      ghl_refresh_token: 'refresh-1',
      ghl_token_expiry: String(Date.now() + 60_000),
    };
    const env = {
      GHL_CLIENT_ID: 'client-id',
      GHL_CLIENT_SECRET: 'client-secret',
      PORTAL_KV: {
        // Always serve the stale snapshot — models the colo cache.
        get: vi.fn(async (k) => staleSnapshot[k] ?? null),
        put: vi.fn(async () => {}),
      },
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-2', expires_in: 86399 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getAccessToken(env);
    const second = await getAccessToken(env);

    expect(first).toBe('fresh-token');
    expect(second).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('memo keeps subsequent calls alive after a persist failure (no second doomed refresh)', async () => {
    const env = makeEnv({ ghl_refresh_token: 'refresh-1' });
    env.PORTAL_KV.put = vi.fn(async () => { throw new Error('KV write failed'); });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-2', expires_in: 86399 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getAccessToken(env);
    const second = await getAccessToken(env);

    expect(first).toBe('fresh-token');
    expect(second).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still returns the valid access token when KV persistence fails after rotation', async () => {
    // The rotation already happened at GHL — throwing away a working access
    // token because a put failed just kills the caller for nothing. Loud
    // logging covers the (already-lost) refresh token.
    const env = makeEnv({ ghl_refresh_token: 'refresh-1' });
    env.PORTAL_KV.put = vi.fn(async () => { throw new Error('KV write failed'); });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-2', expires_in: 86399 }),
    })));

    const token = await getAccessToken(env);

    expect(token).toBe('fresh-token');
  });
});
