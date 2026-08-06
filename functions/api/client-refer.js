// Cloudflare Pages Function: POST /api/client-refer
// Handles invite form submission from /invite?ref=CONTACT_ID
// Creates (or upserts) the referred person's contact in GHL and tags them as a client referral.
//
// Does NOT increment the referral count — that only happens in referral-complete.js
// when the referred person completes a session purchase.
//
// Payload: { referrerId: string, referredName: string, referredPhone: string }

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const BOOKING_URL = "https://amarimethodbooking.amarimethod.com/amari-method-funnel";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// Fetch all custom field definitions and return a map of shortKey → fieldId.
// Used to resolve field IDs for write operations without hardcoding.
async function fetchFieldDefs(apiKey) {
  try {
    const res = await fetch(`${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`, {
      headers: ghlHeaders(apiKey),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const fieldDefs = {};
    for (const f of (data.customFields || [])) {
      const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
      if (shortKey) fieldDefs[shortKey] = f.id;
    }
    return fieldDefs;
  } catch (err) {
    console.error("[client-refer] fetchFieldDefs error:", err.message);
    return {};
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  // Legacy public links embed a raw referrer contact ID. They are retired
  // rather than accepting attribution that the visitor cannot prove they own.
  // A future replacement must use an issued, signed referral link.
  return new Response(
    JSON.stringify({ error: "Client referral links are no longer active." }),
    { status: 410, headers }
  );

  try {
    const GHL_API_KEY = await getGhlToken(context);

    if (!GHL_API_KEY) {
      console.error("[client-refer] GHL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    const body = await context.request.json();
    const { referrerId, referredName, referredPhone } = body;

    // ── Input validation ──
    if (!referrerId || typeof referrerId !== "string" || referrerId.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid referral link" }),
        { status: 400, headers }
      );
    }
    if (!referredName || typeof referredName !== "string" || referredName.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Please enter your first name" }),
        { status: 400, headers }
      );
    }
    if (!referredPhone || typeof referredPhone !== "string" || referredPhone.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Please enter your phone number" }),
        { status: 400, headers }
      );
    }
    const phoneDigitCount = (referredPhone.match(/\d/g) || []).length;
    if (phoneDigitCount < 10) {
      return new Response(
        JSON.stringify({ error: "Phone number must have at least 10 digits" }),
        { status: 400, headers }
      );
    }

    const sanitizedReferrerId = referrerId.trim().slice(0, 50);
    const sanitizedName = referredName.trim().slice(0, 100);
    const sanitizedPhone = referredPhone.trim().slice(0, 20);

    // ── Verify referrer exists in GHL (prevents abuse of random IDs) ──
    const [referrerRes, fieldDefs] = await Promise.all([
      fetch(`${GHL_API_BASE}/contacts/${sanitizedReferrerId}`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetchFieldDefs(GHL_API_KEY),
    ]);

    if (!referrerRes.ok) {
      console.warn(`[client-refer] Referrer not found or invalid: ${sanitizedReferrerId} (${referrerRes.status})`);
      return new Response(
        JSON.stringify({ error: "Invalid referral link" }),
        { status: 400, headers }
      );
    }

    // ── Build upsert payload ──
    const referredByFieldId = fieldDefs["referred_by_client_id"];

    if (!referredByFieldId) {
      console.error("[client-refer] referred_by_client_id field not found in GHL — field may not be created yet");
    }

    // Always include referred_by_client_id so the referrer is recorded.
    // If the contact already exists with this field set (submitted via another link),
    // the most recent submission wins. True deduplication (counting each payer once)
    // is enforced in referral-complete.js by clearing this field after processing.
    const customFields = referredByFieldId
      ? [{ id: referredByFieldId, field_value: sanitizedReferrerId }]
      : [];

    const upsertPayload = {
      firstName: sanitizedName,
      phone: sanitizedPhone,
      locationId: GHL_LOCATION_ID,
      tags: ["client-referral"],
      source: "Client Referral — Invite Page",
      ...(customFields.length > 0 && { customFields }),
    };

    const upsertRes = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: ghlHeaders(GHL_API_KEY),
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertRes.ok) {
      const errorText = await upsertRes.text();
      console.error(`[client-refer] GHL upsert error: ${upsertRes.status} ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Something went wrong. Please try again." }),
        { status: 422, headers }
      );
    }

    const upsertData = await upsertRes.json();
    const contactId = upsertData.contact?.id;
    console.log(`[client-refer] Contact upserted: ${contactId || "unknown"} (referred by: ${sanitizedReferrerId})`);

    return new Response(
      JSON.stringify({ success: true, bookingUrl: BOOKING_URL }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error("[client-refer] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
