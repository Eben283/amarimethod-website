// Cloudflare Pages Function: GET /api/ghl-export-tokens
// One-time local-setup utility: exports GHL OAuth tokens from KV so
// ~/.claude/ghl-mcp/setup.js can pull them into tokens.json.
//
// HARDENED (N2, 2026-06-11 review): this returns the full GHL access + refresh
// tokens — effectively full CRM access (read/write all contacts, payments,
// calendars). So it is locked down two ways:
//   1. OFF by default — returns 404 unless GHL_TOKEN_EXPORT_ENABLED === "true".
//      Flip the flag on in the Pages env for a setup window, run setup.js, then
//      turn it off again. While off, the endpoint doesn't even advertise itself.
//   2. Authenticated by an `Authorization: Bearer <GHL_OAUTH_SETUP_SECRET>`
//      header with a constant-time compare — NOT a query-string secret, which
//      leaks into CDN/proxy logs, referrers, and browser history.

const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Constant-time string compare (length check leaks only the secret length).
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function onRequestGet(context) {
  // Off by default — return 404 so the endpoint's existence isn't advertised.
  if (context.env.GHL_TOKEN_EXPORT_ENABLED !== "true") {
    return new Response("Not found", { status: 404 });
  }

  const setupSecret = context.env.GHL_OAUTH_SETUP_SECRET;
  const authHeader = context.request.headers.get("Authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!setupSecret || !provided || !timingSafeEqual(provided, setupSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response("Missing PORTAL_KV binding", { status: 500 });
  }

  const [accessToken, refreshToken, tokenExpiry] = await Promise.all([
    kv.get("ghl_access_token"),
    kv.get("ghl_refresh_token"),
    kv.get("ghl_token_expiry"),
  ]);

  if (!accessToken || !refreshToken) {
    return new Response("No tokens found in KV. Complete OAuth flow first.", { status: 404 });
  }

  const tokens = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Number(tokenExpiry) || 0,
    location_id: LOCATION_ID,
  };

  return new Response(JSON.stringify(tokens), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
