// Cloudflare Pages Function: POST /api/portal-update-preference
// Sets the logged-in client's reminder preference (all | some | none) on the
// GHL custom field "Reminder Preference". The GHL follow-up reminder workflow
// reads this field (If/Else) to decide which reminders to send. Writing only
// touches this one field — it never changes DND/communication consent.
//
// Auth pattern copied from portal-data.js; write pattern from send-to-ghl.js.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { isContactRevoked } from "../lib/session-guard.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const REMINDER_PREFERENCE_FIELD_ID = "a42sQtjQ2yZPd0eJmkGW"; // contact.reminder_preference
const VALID = ["all", "some", "none"];

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
  const jsonError = (status, error) =>
    new Response(JSON.stringify({ error }), { status, headers });

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    const GHL_API_KEY = await getGhlToken(context);
    if (!JWT_SECRET || !GHL_API_KEY) {
      console.error("[update-preference] Missing env vars");
      return jsonError(500, "Server configuration error");
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonError(401, "Not authenticated");
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return jsonError(401, "Session expired. Please log in again.");
    }

    const contactId = tokenPayload.contactId;
    if (await isContactRevoked(context.env.PORTAL_KV, contactId)) {
      return jsonError(401, "Session expired. Please log in again.");
    }

    const body = await context.request.json().catch(() => ({}));
    const preference = String(body.preference || "").toLowerCase();
    if (!VALID.includes(preference)) {
      return jsonError(400, "Invalid preference. Expected all, some, or none.");
    }

    const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: ghlHeaders(GHL_API_KEY),
      body: JSON.stringify({
        customFields: [{ id: REMINDER_PREFERENCE_FIELD_ID, field_value: preference }],
      }),
    });

    if (!res.ok) {
      console.error(`[update-preference] GHL PUT error ${res.status}`);
      return jsonError(422, "Could not save your preference. Please try again.");
    }

    return new Response(JSON.stringify({ success: true, preference }), { status: 200, headers });
  } catch (err) {
    console.error("[update-preference] Unexpected error:", err);
    return jsonError(500, "Internal server error");
  }
}
