// Cloudflare Pages Function: GET /api/staff-contacts?query=
// Search contacts by name, email, or phone

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "./portal-data.js";

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export async function onRequestGet(context) {
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
      };
    });

    return new Response(JSON.stringify(results), { status: 200, headers });
  } catch (err) {
    console.error("[staff-contacts] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
