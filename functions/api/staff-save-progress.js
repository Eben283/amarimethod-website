// Cloudflare Pages Function: POST /api/staff-save-progress
// Saves client progress (modules taught, body graph, yoga block) to GHL custom field

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const FIELD_ID_CLIENT_PROGRESS = "n2F1hn5U59qtv1dx8mJG";

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

    // Verify staff auth
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

    // Parse request body
    const body = await context.request.json();
    const { contactId, progress } = body;

    if (!contactId || !progress) {
      return new Response(JSON.stringify({ error: "contactId and progress are required" }), { status: 400, headers });
    }

    // Validate progress shape
    if (typeof progress.modules !== "object" || typeof progress.bodyGraph !== "object") {
      return new Response(JSON.stringify({ error: "Invalid progress format" }), { status: 400, headers });
    }

    // Save progress as JSON string to the client_progress custom field
    const progressJson = JSON.stringify(progress);

    const updateRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({
        customFields: [{ id: FIELD_ID_CLIENT_PROGRESS, field_value: progressJson }],
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(`[staff-save-progress] Contact update failed: ${updateRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to save progress" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-save-progress] Error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
