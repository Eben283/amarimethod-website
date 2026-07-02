// Shared GHL OAuth token management for Cloudflare Workers.
//
// Every Worker in this repo (daily-audit, series-reconcile,
// partner-activity-refresh, conversation-cache, funnel-refresh, coach-daily,
// call-coach) used to carry its own byte-for-byte identical copy of this
// logic — found during the 2026-07-01 cron-job architecture audit. Tokens
// live in PORTAL_KV, refreshed by the ghl-token-refresh worker on a 12h cron
// and on-demand here when a caller needs a token that's near expiry.
//
// Deliberately NOT extracted: each Worker's own request wrapper (ghlFetch/
// ghlGet/ghlRetry/etc.) and domain-specific helpers. Those vary legitimately
// — different retry behavior, different auto-locationId injection, different
// GHL endpoints per Worker's job — only the token plumbing underneath them
// was actually duplicated.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = `${GHL_BASE}/oauth/token`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";

// Module-level memo of the last known-good token. Two failure modes need it:
// (1) KV reads are colo-cached (~60s), so the sequential call right AFTER a
// successful refresh can read the stale access token back and burn the
// already-consumed refresh token; (2) when persistence fails after rotation,
// the memo is the only copy that keeps the rest of this run alive.
let memoToken = null;
let memoExpiry = 0;

// Test hook — the memo/latch are module state that would leak across tests.
export function _resetForTests() {
  memoToken = null;
  memoExpiry = 0;
  refreshInFlight = null;
}

// KV puts that guard the freshly-rotated (single-use!) refresh token get a
// few attempts with backoff before we give up — a transient put failure here
// doesn't just lose a cache entry, it orphans the only copy of the new
// refresh token.
async function putWithRetry(kv, key, value, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await kv.put(key, value);
      return true;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  console.error(`[ghl-worker-token] KV put failed after ${attempts} attempts (${key}): ${lastErr?.message}`);
  return false;
}

async function refreshToken(env) {
  const kv = env.PORTAL_KV;
  const refreshTok = await kv.get(KV_REFRESH_TOKEN);
  if (!refreshTok) throw new Error("No refresh token in KV");

  const { GHL_CLIENT_ID: clientId, GHL_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) throw new Error("Missing GHL_CLIENT_ID or GHL_CLIENT_SECRET");

  const res = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshTok,
    }).toString(),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

  const data = await res.json();
  const newExpiry = Date.now() + (data.expires_in || 86399) * 1000;

  // The rotation already happened at GHL the moment this response arrived —
  // the old refresh token is dead. Memoize FIRST (the memo is what keeps
  // this run alive even if every put below fails), then persist with
  // retries. Sequential, expiry LAST: a fresh expiry landing over a stale
  // access token would make every consumer treat the dead token as valid
  // for ~12h with no on-demand refresh ever triggering.
  memoToken = data.access_token;
  memoExpiry = newExpiry;

  const okAccess = await putWithRetry(kv, KV_ACCESS_TOKEN, data.access_token);
  const okRefresh = await putWithRetry(kv, KV_REFRESH_TOKEN, data.refresh_token || refreshTok);
  const okExpiry =
    okAccess && okRefresh ? await putWithRetry(kv, KV_TOKEN_EXPIRY, String(newExpiry)) : false;
  if (!okAccess || !okRefresh || !okExpiry) {
    console.error(
      "[ghl-worker-token] CRITICAL token-lost risk: GHL rotation succeeded but KV persist failed — " +
      "the stored refresh token may now be dead. Re-auth may be required at next refresh.",
    );
  }

  return data.access_token;
}

// Single-flight latch: parallel getAccessToken calls in this isolate share
// ONE refresh instead of racing N POSTs at the single-use refresh token
// (daily-audit fans out 4 GHL fetches per contact — without this, a stale
// token turns every fan-out into a refresh stampede where one call wins and
// the rest 4xx).
let refreshInFlight = null;

async function refreshWithDoubleCheck(env) {
  const kv = env.PORTAL_KV;
  // Re-read KV before burning the refresh token: a peer writer (the
  // ghl-token-refresh cron, a Pages Function, another worker's isolate) may
  // have refreshed between our staleness check and now. Using their token
  // costs two KV reads; racing them costs the shared refresh token.
  const [current, expiryStr] = await Promise.all([
    kv.get(KV_ACCESS_TOKEN),
    kv.get(KV_TOKEN_EXPIRY),
  ]);
  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  if (current && expiry > Date.now() + REFRESH_BUFFER_MS) {
    memoToken = current;
    memoExpiry = expiry;
    return current;
  }
  return refreshToken(env);
}

export async function getAccessToken(env) {
  const kv = env.PORTAL_KV;
  if (!kv) throw new Error("PORTAL_KV binding not available");

  // Memo first — see the note above memoToken. KV's colo cache can serve a
  // pre-refresh snapshot for up to ~60s after our own refresh.
  if (memoToken && memoExpiry > Date.now() + REFRESH_BUFFER_MS) {
    return memoToken;
  }

  const [accessToken, expiryStr] = await Promise.all([
    kv.get(KV_ACCESS_TOKEN),
    kv.get(KV_TOKEN_EXPIRY),
  ]);

  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  if (accessToken && expiry > Date.now() + REFRESH_BUFFER_MS) {
    memoToken = accessToken;
    memoExpiry = expiry;
    return accessToken;
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshWithDoubleCheck(env).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
