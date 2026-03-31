// Cloudflare Pages Function: POST /api/staff-save-progress
// Saves client progress to GHL custom fields in "Session Progress" folder

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

// Module field IDs (CHECKBOX — value "Taught" or empty)
const MODULE_FIELDS = {
  "suspension-squat": "ppSis1mS8JHM0zFY5WdC",
  "hand-balancer": "8Nj0epPxQu2xRQVKWLSr",
  "power-posture": "AINXSQ2d9ftSdjP1F7dv",
  "vertical-drop": "SjTwE7i2hX3LS4LNeP0K",
  "active-bridge": "YoTmF6hYpgnlQJvWYp45",
  "passive-bridge": "urZ3cDqgN4nzOHdIh4zJ",
  "spinal-wave": "o3g5WTKILzlsqJDRx5ih",
  "spring-step": "s5to40stQCSB57zc3owp",
  "elbow-reset": "PLrwPYX98bLAidRUeCYZ",
  "jaw-align": "ZNPU1PmYbpOiv3O5nkMK",
};

// Body region field IDs (SINGLE_OPTIONS — "Active", "Passive", or empty)
const BODY_FIELDS = {
  upper: "9oSw5yoTilNxeZmqvKpB",
  middle: "lByUKfOFQ3wpglFr4NHe",
  lower: "yeiKwwcNnuUsAAz1LpQt",
};

// Yoga block size field ID (SINGLE_OPTIONS — '3"', '4"', or empty)
const YOGA_BLOCK_FIELD = "dRiVGU2Q2lRbCAaPIQai";

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
    const { contactId, progress } = body;

    if (!contactId || !progress) {
      return new Response(JSON.stringify({ error: "contactId and progress are required" }), { status: 400, headers });
    }

    // Build custom fields array from progress state
    const customFields = [];

    // Modules — checkbox fields: ["Taught"] if true, [] if false
    for (const [moduleId, fieldId] of Object.entries(MODULE_FIELDS)) {
      const taught = !!progress.modules?.[moduleId];
      customFields.push({
        id: fieldId,
        field_value: taught ? ["Taught"] : [],
      });
    }

    // Body regions — dropdown: "Active", "Passive", or ""
    for (const [region, fieldId] of Object.entries(BODY_FIELDS)) {
      const state = progress.bodyGraph?.[region];
      const value = state === "active" ? "Active" : state === "passive" ? "Passive" : "";
      customFields.push({ id: fieldId, field_value: value });
    }

    // Yoga block size — dropdown: '3"', '4"', or ""
    const blockSize = progress.yogaBlockSize;
    customFields.push({
      id: YOGA_BLOCK_FIELD,
      field_value: blockSize === "3" ? '3"' : blockSize === "4" ? '4"' : "",
    });

    const updateRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({ customFields }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(`[staff-save-progress] Update failed: ${updateRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to save progress" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-save-progress] Error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
