// Cloudflare Pages Function: GET /api/staff-contacts?query=
// Search contacts by name, email, or phone

import { ghlFetch } from "../lib/ghl.js";
import { getCustomField } from "../lib/portal-helpers.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";


export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const url = new URL(context.request.url);
    const query = (url.searchParams.get("query") || "").trim();

    if (!query || query.length < 2) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    // Search contacts in GHL
    const searchUrl = `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(query)}&limit=20`;
    const searchRes = await ghlFetch(context, searchUrl);

    if (!searchRes.ok) {
      console.error(`[staff-contacts] GHL search error: ${searchRes.status}`);
      return new Response(JSON.stringify({ error: "Search failed" }), { status: 422, headers });
    }

    const searchData = await searchRes.json();
    const contacts = searchData.contacts || [];

    // Fetch custom field definitions for series info
    const fieldDefsRes = await ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`);
    let fieldDefs = {};
    if (fieldDefsRes.ok) {
      const fieldDefsData = await fieldDefsRes.json();
      for (const f of (fieldDefsData.customFields || [])) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    const results = contacts.map((c) => {
      const firstName = c.firstName || "";
      const lastName = c.lastName || "";
      const name = [firstName, lastName].filter(Boolean).join(" ") || c.email || "Unknown";

      return {
        id: c.id,
        name,
        email: c.email || "",
        phone: c.phone || "",
        lastAppointment: null, // Would need separate API call per contact — skip for list
        sessionsRemaining: parseInt(getCustomField(c, "sessions_remaining", fieldDefs) ?? "0", 10),
        seriesType: getCustomField(c, "series_type", fieldDefs) || "none",
        isFoundersCircle: (c.tags || []).some((t) => String(t).toLowerCase() === "founders-circle"),
      };
    });

    return new Response(JSON.stringify(results), { status: 200, headers });
  } catch (err) {
    console.error("[staff-contacts] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
