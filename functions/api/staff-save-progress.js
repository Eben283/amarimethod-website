// Cloudflare Pages Function: POST /api/staff-save-progress
// Saves client progress to GHL custom fields in "Session Progress" folder

import { ghlFetch } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

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
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


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
