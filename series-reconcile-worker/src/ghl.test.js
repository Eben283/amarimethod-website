import { describe, it, expect, vi, afterEach } from 'vitest';
import { listRecentCompletedOrders, fetchActiveSeriesContactIds } from './ghl.js';

// Field IDs from ghl.js SWEEP_FIELD.
const FIELD = {
  series_type: '3i93lTkmuAV49s9nh0q8',
  sessions_remaining: 'wrQSkx6BhXwDGIn1d0V4',
  session_prepaid: 'sgQ5EbJWhvTfGVhStaOO',
};

// env whose KV hands back a still-valid access token, so getAccessToken never
// hits the refresh path — these tests exercise the domain helpers, not auth.
function env() {
  return {
    PORTAL_KV: {
      get: async (k) =>
        k === 'ghl_access_token' ? 't'
          : k === 'ghl_token_expiry' ? String(Date.now() + 3_600_000)
          : null,
    },
  };
}

const ok = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });

afterEach(() => vi.unstubAllGlobals());

describe('listRecentCompletedOrders', () => {
  // Serve /payments/orders pages keyed by the offset in the query string.
  function stubOrders(pagesByIndex) {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const m = String(url).match(/offset=(\d+)/);
      const offset = m ? parseInt(m[1], 10) : 0;
      calls.push(offset);
      return ok({ data: pagesByIndex[offset / 50] || [] });
    }));
    return calls;
  }

  it('selects only orders updated within the window and does NOT early-break on an old createdAt (HIGH-7)', async () => {
    const since = Date.parse('2026-06-10T00:00:00Z');
    // C (out of window) sits BEFORE B in the list; the old code that broke on
    // the first pre-window order would have missed B — the late-paid orphan
    // (old createdAt, recent updatedAt) this worker exists to catch.
    const page = [
      { _id: 'A', updatedAt: '2026-06-12T00:00:00Z' },
      { _id: 'C', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { _id: 'B', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z' },
    ];
    stubOrders([page]); // 3 < 50 → single page, loop stops
    const out = await listRecentCompletedOrders(env(), since);
    expect(out.map((o) => o._id).sort()).toEqual(['A', 'B']);
  });

  it('paginates until a short page and stops', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ _id: `p1-${i}`, updatedAt: '2026-06-12T00:00:00Z' }));
    const short = [{ _id: 'p2-0', updatedAt: '2026-06-12T00:00:00Z' }];
    const calls = stubOrders([full, short]);
    const out = await listRecentCompletedOrders(env(), 0);
    expect(out).toHaveLength(51);
    expect(calls).toEqual([0, 50]); // exactly two fetches
  });

  it('warns and stops at the MAX_PAGES (300-order) scan cap', async () => {
    const full = () => Array.from({ length: 50 }, (_, i) => ({ _id: `x${i}`, updatedAt: '2026-06-12T00:00:00Z' }));
    const calls = stubOrders([full(), full(), full(), full(), full(), full()]); // 6 = MAX_PAGES
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await listRecentCompletedOrders(env(), 0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/scan cap/));
    expect(calls).toHaveLength(6); // didn't run past the cap
    warn.mockRestore();
  });
});

describe('fetchActiveSeriesContactIds', () => {
  const cf = (defs) => ({ customFields: Object.entries(defs).map(([id, value]) => ({ id, value })) });

  // Serve /contacts/search pages keyed by the `page` in the POST body.
  function stubContacts(pagesByPageNumber) {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const page = JSON.parse(opts.body).page;
      calls.push(page);
      return ok({ contacts: pagesByPageNumber[page - 1] || [] });
    }));
    return calls;
  }

  it('includes active-series / remaining>0 / prepaid contacts and excludes inactive ones', async () => {
    const page = [
      { id: 'series', ...cf({ [FIELD.series_type]: '8-session' }) },
      { id: 'remaining', ...cf({ [FIELD.sessions_remaining]: '3' }) },
      { id: 'prepaid', ...cf({ [FIELD.session_prepaid]: 'yes' }) },
      { id: 'inactive', ...cf({ [FIELD.series_type]: 'none', [FIELD.sessions_remaining]: '0', [FIELD.session_prepaid]: 'no' }) },
    ];
    stubContacts([page]); // 4 < 100 → single page
    const ids = await fetchActiveSeriesContactIds(env());
    expect(ids.sort()).toEqual(['prepaid', 'remaining', 'series']);
  });

  it('warns when it hits the 1000-contact pagination cap (M8)', async () => {
    const full = () => Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, ...cf({ [FIELD.sessions_remaining]: '1' }) }));
    const calls = stubContacts(Array.from({ length: 10 }, full)); // 10 = PAGE_CAP
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchActiveSeriesContactIds(env());
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/pagination cap/));
    expect(calls).toHaveLength(10);
    warn.mockRestore();
  });
});
