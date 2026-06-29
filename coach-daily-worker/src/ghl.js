// GHL API helpers — same token/retry pattern as conversation-cache-worker/src/ghl.js.
// Tokens are managed in PORTAL_KV by the ghl-token-refresh worker.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = `${GHL_BASE}/oauth/token`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";

export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

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

  await Promise.all([
    kv.put(KV_ACCESS_TOKEN, data.access_token),
    kv.put(KV_REFRESH_TOKEN, data.refresh_token || refreshTok),
    kv.put(KV_TOKEN_EXPIRY, String(newExpiry)),
  ]);
  return data.access_token;
}

export async function getAccessToken(env) {
  const kv = env.PORTAL_KV;
  const [accessToken, expiryStr] = await Promise.all([
    kv.get(KV_ACCESS_TOKEN),
    kv.get(KV_TOKEN_EXPIRY),
  ]);
  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  if (accessToken && expiry > Date.now() + REFRESH_BUFFER_MS) return accessToken;
  return refreshToken(env);
}

export async function ghlFetch(env, path) {
  const token = await getAccessToken(env);
  const url = new URL(`${GHL_BASE}${path}`);
  if (!url.searchParams.has("locationId") && !url.searchParams.has("location_id") && !url.searchParams.has("altId")) {
    url.searchParams.set("locationId", LOCATION_ID);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Version: "2021-07-28" },
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`GHL API ${res.status}: ${e}`); }
  return res.json();
}

// POST variant — locationId goes in the body, not the URL.
export async function ghlPost(env, path, body) {
  const token = await getAccessToken(env);
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Version: "2021-07-28" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`GHL API ${res.status}: ${e}`); }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isRetryable(err) {
  const msg = String(err?.message ?? err ?? "");
  const m = msg.match(/^GHL API (\d+):/);
  if (m) {
    const status = Number(m[1]);
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true;
    if (status === 400 && /request timeout|timed?\s*out|gateway timeout/i.test(msg)) return true;
    return false;
  }
  return /fetch failed|network|timed?\s*out|socket|econn|abort/i.test(msg);
}

export async function ghlRetry(env, path, tries = 6) {
  const baseMs = Number(env?.GHL_RETRY_BASE_MS) || 600;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await ghlFetch(env, path); }
    catch (e) {
      lastErr = e;
      if (!isRetryable(e) || i === tries - 1) throw e;
      await sleep(baseMs * 2 ** i + Math.floor(baseMs * Math.random()));
    }
  }
  throw lastErr;
}

// POST with retry (used by link-stalls contacts/search).
export async function ghlPostRetry(env, path, body, tries = 4) {
  const baseMs = Number(env?.GHL_RETRY_BASE_MS) || 600;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await ghlPost(env, path, body); }
    catch (e) {
      lastErr = e;
      if (!isRetryable(e) || i === tries - 1) throw e;
      await sleep(baseMs * 2 ** i + Math.floor(baseMs * Math.random()));
    }
  }
  throw lastErr;
}
