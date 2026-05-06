// Cloudflare Pages Function: GET /api/stream-token?uid=<streamUid>
//
// Returns a signed Cloudflare Stream HLS playback URL for a Living Practice
// course video. Validates the portal session (same JWT pattern as portal-data),
// confirms the contact has `living_practice_access`, then mints a short-lived
// Stream signed token and returns the manifest URL.
//
// Without this gate, Stream's manifest URLs are public-by-obscurity. With it,
// each playback request is bound to a logged-in user with a paid course.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { computeHasLivingPractice, getCustomField } from "./portal-data.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    const CF_ACCOUNT_ID = context.env.CF_STREAM_ACCOUNT_ID;
    const CF_STREAM_TOKEN = context.env.CF_STREAM_TOKEN;
    const CUSTOMER_CODE = context.env.CF_STREAM_CUSTOMER_CODE;
    const GHL_API_KEY = await getGhlToken(context);

    if (!JWT_SECRET || !CF_ACCOUNT_ID || !CF_STREAM_TOKEN || !CUSTOMER_CODE || !GHL_API_KEY) {
      console.error("[stream-token] Missing env vars");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Validate streamUid query param — must be a Cloudflare Stream UID (32 hex chars)
    const url = new URL(context.request.url);
    const streamUid = url.searchParams.get("uid");
    if (!streamUid || !/^[a-f0-9]{32}$/.test(streamUid)) {
      return new Response(
        JSON.stringify({ error: "Invalid uid parameter" }),
        { status: 400, headers }
      );
    }

    // Validate session token
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers }
      );
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(
        JSON.stringify({ error: "Session expired. Please log in again." }),
        { status: 401, headers }
      );
    }

    const contactId = tokenPayload.contactId;

    // Confirm the contact has Living Practice access. Mirror the logic used in
    // portal-data.js: explicit field, tag, OR 8-session series qualifies.
    const [contactResponse, fieldDefsResponse] = await Promise.all([
      fetch(`${GHL_API_BASE}/contacts/${contactId}`, { headers: ghlHeaders(GHL_API_KEY) }),
      fetch(`${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`, { headers: ghlHeaders(GHL_API_KEY) }),
    ]);

    if (!contactResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Unable to verify access. Try again." }),
        { status: 422, headers }
      );
    }

    const fieldDefs = {};
    if (fieldDefsResponse.ok) {
      const fieldDefsData = await fieldDefsResponse.json();
      for (const f of fieldDefsData.customFields || []) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    const contactData = await contactResponse.json();
    const contact = contactData.contact;
    const seriesType = getCustomField(contact, "series_type", fieldDefs) || "none";
    const lpRaw = getCustomField(contact, "living_practice_access", fieldDefs);
    const tags = contact.tags || [];

    if (!computeHasLivingPractice(lpRaw, tags, seriesType)) {
      return new Response(
        JSON.stringify({ error: "No Living Practice access on this account." }),
        { status: 403, headers }
      );
    }

    // Mint a Stream signed token. Token is bound to this single video UID.
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const tokenRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${streamUid}/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_STREAM_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ exp, downloadable: false }),
      }
    );

    const tokenJson = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenJson?.success) {
      console.error(`[stream-token] Stream API error for uid=${streamUid}: ${JSON.stringify(tokenJson?.errors)}`);
      // Use 422, not 502 — Cloudflare Pages intercepts 502/503 and replaces the body
      return new Response(
        JSON.stringify({ error: "Could not generate playback URL. Try again." }),
        { status: 422, headers }
      );
    }

    const signedToken = tokenJson.result.token;

    // Build the HLS manifest URL. Format:
    //   https://customer-{code}.cloudflarestream.com/{signed_token}/manifest/video.m3u8
    const hlsUrl = `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${signedToken}/manifest/video.m3u8`;

    return new Response(
      JSON.stringify({ hlsUrl, expiresAt: exp * 1000 }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[stream-token] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers }
    );
  }
}
