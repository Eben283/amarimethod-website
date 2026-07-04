// Cloudflare Pages Function: GET /api/ghl-oauth-callback
// One-time OAuth2 callback — exchanges the GHL authorization code for tokens and
// stores them in KV. After initial setup it is only needed if the refresh token
// expires (~1 year) or the client pair is rotated.
//
// Reachable unauthenticated BY DESIGN: GHL redirects the browser here with ?code=,
// so we cannot require a secret at the HTTP layer without breaking re-auth. Instead
// we gate the damaging action — overwriting the production token store — by refusing
// a token that is explicitly scoped to a DIFFERENT GHL location. An OAuth flow
// completed for someone else's location can no longer clobber our tokens (F#1).
//
// Deliberately NOT strict: a GHL token exchange returns `locationId` for a
// Location-class install, but a fresh app reinstall reliably yields an Agency-class
// token with no locationId, which the documented recovery flow then upgrades via
// /oauth/locationToken (see memory reference-ghl-authclass-location-token). We must
// leave that path working, so an absent locationId is allowed through — only a
// PRESENT-and-mismatched locationId is rejected.

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

// The Amari GHL location this token store belongs to.
const EXPECTED_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// True only when the exchange result is explicitly scoped to a location OTHER than
// ours. Agency/company tokens (no locationId) return false so the existing reinstall
// → /oauth/locationToken recovery flow is undisturbed.
export function isForeignLocationToken(data, expectedLocationId = EXPECTED_LOCATION_ID) {
  return Boolean(data && data.locationId && data.locationId !== expectedLocationId);
}

export async function onRequestGet(context) {
  try {
    // Security: GHL OAuth codes are one-time-use and expire quickly.
    // The callback is only reachable via GHL's redirect after user authorization.
    const url = new URL(context.request.url);
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

    // Gate the token-store overwrite: refuse a token scoped to a DIFFERENT location.
    // This stops an OAuth flow completed for someone else's location from clobbering
    // our production tokens (F#1). Agency-class tokens (no locationId) pass through so
    // the reinstall → /oauth/locationToken recovery flow keeps working.
    if (isForeignLocationToken(data)) {
      console.error(`[ghl-oauth] Refusing to store tokens — locationId '${data.locationId}' is not the Amari location`);
      return new Response(
        "This authorization is for a different GHL location. Tokens were not stored.",
        { status: 403, headers: { "Content-Type": "text/plain" } }
      );
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
