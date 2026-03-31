// Cloudflare Pages Function: POST /api/staff-toggle-prepaid
// Toggles the session_prepaid custom field on a contact

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const FIELD_ID_SESSION_PREPAID = "sgQ5EbJWhvTfGVhStaOO";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
    }

    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const body = await context.request.json();
    const contactId = (body.contactId || "").trim();
    const prepaid = body.prepaid === true;

    if (!contactId) {
      return new Response(JSON.stringify({ error: "Contact ID required" }), { status: 400, headers });
    }

    const updateRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({
        customFields: [
          { id: FIELD_ID_SESSION_PREPAID, field_value: prepaid ? "yes" : "no" },
        ],
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(`[staff-toggle-prepaid] Update error: ${updateRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to update prepaid status" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true, prepaid }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-toggle-prepaid] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
