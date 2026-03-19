// Temporary endpoint: GET /api/ghl-export-tokens?secret=XXX
// Reads OAuth2 tokens from KV and returns them for local MCP setup.
// Delete this file after local tokens are saved.

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const secret = url.searchParams.get("secret");
  const setupSecret = context.env.GHL_OAUTH_SETUP_SECRET;

  if (!setupSecret || secret !== setupSecret) {
    return new Response("Unauthorized", { status: 403 });
  }

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response("PORTAL_KV not bound", { status: 500 });
  }

  const [accessToken, refreshToken, expiry] = await Promise.all([
    kv.get("ghl_access_token"),
    kv.get("ghl_refresh_token"),
    kv.get("ghl_token_expiry"),
  ]);

  if (!refreshToken) {
    return new Response("No tokens in KV — run OAuth2 flow first", { status: 404 });
  }

  return new Response(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: parseInt(expiry || "0", 10),
      location_id: "7pIO7FHVAyBT1jKGhfQM",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
