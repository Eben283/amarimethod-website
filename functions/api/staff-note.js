// Cloudflare Pages Function: POST /api/staff-note
// Add a note to a contact in GHL

import { ghlFetch } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";


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


    const { body, error: parseError } = await parseJsonBody(context.request, headers);



    if (parseError) return parseError;
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
