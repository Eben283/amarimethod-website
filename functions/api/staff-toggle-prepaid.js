// Cloudflare Pages Function: POST /api/staff-toggle-prepaid
// Toggles the session_prepaid custom field on a contact

import { ghlFetch } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const FIELD_ID_SESSION_PREPAID = "sgQ5EbJWhvTfGVhStaOO";


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
