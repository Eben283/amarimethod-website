// Cloudflare Pages Function: GET /api/ghl-export-tokens
// Exports GHL OAuth tokens from KV so setup.js can pull them locally.
// Protected by GHL_OAUTH_SETUP_SECRET env var.

const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const providedSecret = url.searchParams.get("secret");
  const setupSecret = context.env.GHL_OAUTH_SETUP_SECRET;

  if (!setupSecret || providedSecret !== setupSecret) {
    return new Response("Unauthorized", { status: 403 });
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
