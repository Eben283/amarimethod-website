// Cloudflare Pages Function: GET /api/ghl-oauth-callback
// One-time OAuth2 callback — exchanges authorization code for tokens and stores in KV.
// After initial setup, this endpoint is only needed if the refresh token expires (1 year).
// Protected by GHL_OAUTH_SETUP_SECRET env var to prevent unauthorized use.

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

export async function onRequestGet(context) {
  try {
    // Verify setup secret to prevent unauthorized use
    const setupSecret = context.env.GHL_OAUTH_SETUP_SECRET;
    const url = new URL(context.request.url);

    if (!setupSecret) {
      return new Response("GHL_OAUTH_SETUP_SECRET not configured. Set it in Cloudflare env vars.", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const providedSecret = url.searchParams.get("secret");
    if (providedSecret !== setupSecret) {
      return new Response("Unauthorized. Provide ?secret=YOUR_SETUP_SECRET in the URL.", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const code = url.searchParams.get("code");

    if (!code) {
      return new Response("Missing authorization code. Start the OAuth flow from the GHL install URL.", {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const clientId = context.env.GHL_CLIENT_ID;
    const clientSecret = context.env.GHL_CLIENT_SECRET;
    const kv = context.env.PORTAL_KV;

    if (!clientId || !clientSecret) {
      return new Response("Server missing GHL_CLIENT_ID or GHL_CLIENT_SECRET", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (!kv) {
      return new Response("Server missing PORTAL_KV binding", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(GHL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error(`[ghl-oauth] Token exchange failed: ${tokenResponse.status} ${errText}`);
      return new Response(`Token exchange failed: ${tokenResponse.status}. The code may have expired — restart the OAuth flow.`, {
        status: 422,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const data = await tokenResponse.json();

    if (!data.access_token || !data.refresh_token) {
      console.error("[ghl-oauth] Missing tokens in response:", JSON.stringify(data));
      return new Response("Token exchange returned incomplete data.", {
        status: 422,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const expiresIn = data.expires_in || 86399;
    const expiry = Date.now() + expiresIn * 1000;

    // Store tokens in KV
    await Promise.all([
      kv.put("ghl_access_token", data.access_token),
      kv.put("ghl_refresh_token", data.refresh_token),
      kv.put("ghl_token_expiry", String(expiry)),
    ]);

    console.log("[ghl-oauth] Initial tokens stored successfully");

    return new Response(
      "GHL OAuth2 setup complete. Tokens stored. You can close this page.",
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }
    );
  } catch (err) {
    console.error("[ghl-oauth] Unexpected error:", err);
    return new Response("Internal server error during OAuth setup.", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
