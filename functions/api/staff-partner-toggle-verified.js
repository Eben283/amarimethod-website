// Cloudflare Pages Function: POST /api/staff-partner-toggle-verified
//
// Toggles the existing GHL "Outreach Verified" checkbox custom field
// (PVftrxrmNRPmfdlQAwzl) on a contact. Used from the Partners tab modal.
//
// Request body: { contactId: string, verified: boolean }
// Auth: JWT bearer.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

const OUTREACH_VERIFIED_FIELD_ID = "PVftrxrmNRPmfdlQAwzl";

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
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
    try {
      await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401, headers });
    }

    const payload = await context.request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
    }
    const { contactId, verified } = payload;
    if (!contactId || typeof contactId !== "string") {
      return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
    }
    if (typeof verified !== "boolean") {
      return new Response(JSON.stringify({ error: "verified must be boolean" }), { status: 400, headers });
    }

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) {
      return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });
    }

    // Write the checkbox value. GHL checkbox: value is array of strings — ["Verified"] when checked, [] when unchecked.
    const updateRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        customFields: [
          { id: OUTREACH_VERIFIED_FIELD_ID, value: verified ? ["Verified"] : [] },
        ],
      }),
    });
    if (!updateRes.ok) {
      const text = await updateRes.text().catch(() => "");
      throw new Error(`GHL PUT /contacts/${contactId} ${updateRes.status}: ${text.slice(0, 250)}`);
    }

    return new Response(
      JSON.stringify({ success: true, contactId, verified }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-partner-toggle-verified] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to toggle verified: ${detail}` }),
      { status: 500, headers },
    );
  }
}
