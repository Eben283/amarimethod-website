// Cloudflare Pages Function: POST /api/staff-not-a-fit
// Marks a partner-session contact as "not a fit" — moves their Partnership Pipeline
// opportunity to "Future Potential" stage. Does NOT send any message.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

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

    // Parse request
    const body = await context.request.json();
    const { contactId } = body;

    if (!contactId) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }

    // Verify contact has partner-session-booked tag
    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers });
    }

    const contactData = await contactRes.json();
    const tags = contactData.contact?.tags || [];

    if (!tags.includes("partner-session-booked")) {
      return new Response(JSON.stringify({ error: "Contact does not have partner-session-booked tag" }), { status: 400, headers });
    }

    // Find Partnership Pipeline and its "Future Potential" stage
    const pipelinesRes = await ghlFetch(context, `${GHL_API_BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`);
    if (!pipelinesRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch pipelines" }), { status: 422, headers });
    }

    const pipelinesData = await pipelinesRes.json();
    const partnershipPipeline = (pipelinesData.pipelines || []).find(
      (p) => p.name.toLowerCase().includes("partnership")
    );

    if (!partnershipPipeline) {
      return new Response(JSON.stringify({ error: "Partnership Pipeline not found" }), { status: 422, headers });
    }

    const futureStage = (partnershipPipeline.stages || []).find(
      (s) => s.name.toLowerCase().includes("future potential")
    );

    if (!futureStage) {
      return new Response(JSON.stringify({ error: "Future Potential stage not found in Partnership Pipeline" }), { status: 422, headers });
    }

    // Find the contact's opportunity in the Partnership Pipeline
    const oppsRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${partnershipPipeline.id}&contact_id=${contactId}`
    );

    if (!oppsRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to search opportunities" }), { status: 422, headers });
    }

    const oppsData = await oppsRes.json();
    const opp = (oppsData.opportunities || []).find(
      (o) => o.pipelineId === partnershipPipeline.id
    );

    if (!opp) {
      return new Response(JSON.stringify({ error: "No opportunity found in Partnership Pipeline for this contact" }), { status: 404, headers });
    }

    // Move opportunity to Future Potential stage, status = lost
    const updateRes = await ghlFetch(context, `${GHL_API_BASE}/opportunities/${opp.id}`, {
      method: "PUT",
      body: JSON.stringify({
        pipelineStageId: futureStage.id,
        status: "lost",
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(`[staff-not-a-fit] Opportunity update failed: ${updateRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to update opportunity" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true, stage: "Future Potential" }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-not-a-fit] Error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
