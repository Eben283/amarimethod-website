// GHL API helpers for the funnel-refresh Worker.
// Tokens are managed in PORTAL_KV by the ghl-token-refresh worker (same scheme as
// daily-audit-worker + partner-activity-refresh-worker). This module mirrors
// daily-audit-worker/src/ghl.js for token handling, and adds a `ghlRetry` wrapper
// that ports funnel.mjs's 429 exponential-backoff (GHL burst-limits aggressively).

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = `${GHL_BASE}/oauth/token`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";

// Same location the local funnel.mjs uses (tokens.json location_id) — verified
// 2026-06-12 to equal 7pIO7FHVAyBT1jKGhfQM.
export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// ── Token management ──

async function refreshToken(env) {
  const kv = env.PORTAL_KV;
  const refreshTok = await kv.get(KV_REFRESH_TOKEN);
  if (!refreshTok) throw new Error("No refresh token in KV");

  const { GHL_CLIENT_ID: clientId, GHL_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GHL_CLIENT_ID or GHL_CLIENT_SECRET");
  }

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

  await Promise.all([
    kv.put(KV_ACCESS_TOKEN, data.access_token),
    kv.put(KV_REFRESH_TOKEN, data.refresh_token || refreshTok),
    kv.put(KV_TOKEN_EXPIRY, String(newExpiry)),
  ]);

  return data.access_token;
}

export async function getAccessToken(env) {
  const kv = env.PORTAL_KV;
  if (!kv) throw new Error("PORTAL_KV binding not available");

  const [accessToken, expiryStr] = await Promise.all([
    kv.get(KV_ACCESS_TOKEN),
    kv.get(KV_TOKEN_EXPIRY),
  ]);

  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  if (accessToken && expiry > Date.now() + REFRESH_BUFFER_MS) {
    return accessToken;
  }

  return refreshToken(env);
}

// ── GHL API fetch ──
// Mirrors ghl-client.js ghlFetch: auto-injects locationId unless the path already
// carries locationId/location_id/altId, sends the Version header + Bearer token.
// `path` is everything after GHL_BASE, e.g. "/contacts/?limit=100".

export async function ghlFetch(env, path) {
  const token = await getAccessToken(env);
  const url = new URL(`${GHL_BASE}${path}`);
  if (
    !url.searchParams.has("locationId") &&
    !url.searchParams.has("location_id") &&
    !url.searchParams.has("altId")
  ) {
    url.searchParams.set("locationId", LOCATION_ID);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL API ${res.status}: ${errText}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Is a GHL error transient (worth retrying) vs. a hard failure (give up)?
// ghlFetch throws `GHL API <status>: <body>`. We parse the status EXACTLY (the old
// /429/.test() matched "429" anywhere in the body — e.g. inside a contactId — and
// could retry a hard 400 forever, or miss the real failure mode). Retry on:
//   - 408 / 429 / any 5xx               (rate-limit + upstream/gateway)
//   - 400 whose body is a gateway "Request Timeout" — GHL returns this under load
//     (this is the bug that silently truncated loadContactMeta's pagination)
//   - transport-level errors (fetch reject / abort) that never reached an HTTP status
export function isRetryable(err) {
  const msg = String(err?.message ?? err ?? "");
  const m = msg.match(/^GHL API (\d+):/);
  if (m) {
    const status = Number(m[1]);
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true;
    // The 400 GHL returns under load: {"message":"Request Timeout after 30000ms",...}
    if (status === 400 && /request timeout|timed?\s*out|gateway timeout/i.test(msg)) return true;
    return false; // any other HTTP status (401/403/404/real 400) is a hard failure
  }
  // No HTTP status → transport error (fetch failed, network, abort) → transient.
  return /fetch failed|network|timed?\s*out|socket|econn|abort/i.test(msg);
}

// ghlFetch with exponential backoff on TRANSIENT errors (see isRetryable). Base
// delay is env-overridable (GHL_RETRY_BASE_MS) so tests can run without real waits.
export async function ghlRetry(env, path, tries = 6) {
  const baseMs = Number(env?.GHL_RETRY_BASE_MS) || 600;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await ghlFetch(env, path);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || i === tries - 1) throw e;
      await sleep(baseMs * 2 ** i + Math.floor(baseMs * Math.random()));
    }
  }
  throw lastErr; // exhausted — never silently return undefined
}
