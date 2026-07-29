// Cloudflare Pages Function: POST /api/staff-founders-circle
// Add or remove the founders-circle GHL tag on a contact.
// Body: { contactId, action: "add" | "remove" }

import { applyTagDelta, ghlFetch } from "../lib/ghl.js";
import { FOUNDERS_CIRCLE_TAG, hasFoundersCircleTag } from "../lib/portal-helpers.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

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
    const { error } = await requireStaffAuth(context, headers);
    if (error) return error;

    const body = await context.request.json().catch(() => null);
    const contactId = typeof body?.contactId === "string" ? body.contactId.trim() : "";
    const action = body?.action === "remove" ? "remove" : body?.action === "add" ? "add" : null;
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(contactId) || !action) {
      return new Response(JSON.stringify({ error: "contactId and action (add|remove) required" }), {
        status: 400,
        headers,
      });
    }

    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers });
    }
    const contactData = await contactRes.json();
    const contact = contactData.contact || contactData;
    const already = hasFoundersCircleTag(contact.tags);

    if (action === "add" && !already) {
      await applyTagDelta(context, contactId, { add: [FOUNDERS_CIRCLE_TAG] });
    } else if (action === "remove" && already) {
      await applyTagDelta(context, contactId, { remove: [FOUNDERS_CIRCLE_TAG] });
    }

    return new Response(
      JSON.stringify({
        success: true,
        contactId,
        isFoundersCircle: action === "add" ? true : action === "remove" ? false : already,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("[staff-founders-circle] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
