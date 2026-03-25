// Cloudflare Pages Function: POST /api/staff-note
// Add a note to a contact in GHL

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

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
    const noteBody = (body.body || "").trim();

    if (!contactId) {
      return new Response(JSON.stringify({ error: "Contact ID required" }), { status: 400, headers });
    }
    if (!noteBody) {
      return new Response(JSON.stringify({ error: "Note body required" }), { status: 400, headers });
    }
    if (noteBody.length > 5000) {
      return new Response(JSON.stringify({ error: "Note too long (max 5000 chars)" }), { status: 400, headers });
    }

    const noteRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: noteBody }),
    });

    if (!noteRes.ok) {
      const errText = await noteRes.text();
      console.error(`[staff-note] GHL note create error: ${noteRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to save note" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-note] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
