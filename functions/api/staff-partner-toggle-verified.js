// Cloudflare Pages Function: POST /api/staff-partner-toggle-verified
//
// Toggles the existing GHL "Outreach Verified" checkbox custom field
// (PVftrxrmNRPmfdlQAwzl) on a contact. Used from the Partners tab modal.
//
// Request body: { contactId: string, verified: boolean }
// Auth: JWT bearer.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

const OUTREACH_VERIFIED_FIELD_ID = "PVftrxrmNRPmfdlQAwzl";


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
