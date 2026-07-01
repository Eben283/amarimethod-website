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
