// Temporary diagnostic endpoint — DELETE after OAuth2 is confirmed working
// GET /api/ghl-test — checks if the OAuth2 token in KV works with the GHL API

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

export async function onRequestGet(context) {
  const results = {};

  try {
    // Step 1: Check if we can get a token
    const token = await getGhlToken(context);
    results.tokenObtained = true;
    results.tokenLength = token ? token.length : 0;
    results.tokenPrefix = token ? token.substring(0, 20) + "..." : "null";

    // Step 2: Try a simple GHL API call — get location info
    const contactsRes = await fetch(
      `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&limit=1`,
      { headers: ghlHeaders(token) }
    );
    results.contactsStatus = contactsRes.status;
    results.contactsOk = contactsRes.ok;

    if (!contactsRes.ok) {
      const errText = await contactsRes.text();
      results.contactsError = errText.substring(0, 500);
    } else {
      const data = await contactsRes.json();
      results.contactsCount = (data.contacts || []).length;
    }

    // Step 3: Check KV token expiry
    const kv = context.env.PORTAL_KV;
    if (kv) {
      const expiry = await kv.get("ghl_token_expiry");
      const hasRefresh = !!(await kv.get("ghl_refresh_token"));
      results.tokenExpiry = expiry ? new Date(parseInt(expiry)).toISOString() : "not set";
      results.hasRefreshToken = hasRefresh;
      results.expiresInMinutes = expiry ? Math.round((parseInt(expiry) - Date.now()) / 60000) : "unknown";
    }
  } catch (err) {
    results.error = err.message;
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
