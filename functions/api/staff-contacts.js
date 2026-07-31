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

function mapContact(c, fieldDefs) {
  const firstName = c.firstName || "";
  const lastName = c.lastName || "";
  const name = [firstName, lastName].filter(Boolean).join(" ") || c.email || "Unknown";
  return {
    id: c.id,
    name,
    email: c.email || "",
    phone: c.phone || "",
    lastAppointment: null,
    sessionsRemaining: parseInt(getCustomField(c, "sessions_remaining", fieldDefs) ?? "0", 10),
    seriesType: getCustomField(c, "series_type", fieldDefs) || "none",
    isFoundersCircle: (c.tags || []).some((t) => String(t).toLowerCase() === "founders-circle"),
  };
}

/** Try several GHL search shapes — POST /contacts/search bodies vary by token/API drift. */
async function findContacts(context, query) {
  const attempts = [];

  // 1) POST /contacts/search with free-text query (COS / runbook shape)
  {
    const res = await ghlFetch(context, `${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        pageLimit: 20,
        page: 1,
        query,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return { contacts: data.contacts || [], via: "post-query" };
    }
    attempts.push(`post-query:${res.status}`);
    console.error("[staff-contacts] post-query failed:", res.status, (await res.text()).slice(0, 200));
  }

  // 2) GET /contacts/?query= — list filter used by portal-auth (not GET /contacts/search)
  {
    const res = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(query)}&limit=20`,
    );
    if (res.ok) {
      const data = await res.json();
      return { contacts: data.contacts || [], via: "get-list" };
    }
    attempts.push(`get-list:${res.status}`);
    console.error("[staff-contacts] get-list failed:", res.status, (await res.text()).slice(0, 200));
  }

  // 3) POST filters on first/last/email contains
  const filterSets = [
    [{ field: "firstName", operator: "contains", value: query }],
    [{ field: "lastName", operator: "contains", value: query }],
    [{ field: "email", operator: "contains", value: query }],
  ];
  if (/[\d+]/.test(query)) {
    filterSets.push([{ field: "phone", operator: "contains", value: query.replace(/[^\d+]/g, "") }]);
  }

  const merged = new Map();
  let anyOk = false;
  for (const filters of filterSets) {
    const res = await ghlFetch(context, `${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        pageLimit: 20,
        page: 1,
        filters,
      }),
    });
    if (!res.ok) {
      attempts.push(`filter-${filters[0].field}:${res.status}`);
      console.error(
        `[staff-contacts] filter ${filters[0].field} failed:`,
        res.status,
        (await res.text()).slice(0, 200),
      );
      continue;
    }
    anyOk = true;
    const data = await res.json();
    for (const c of data.contacts || []) {
      if (c?.id) merged.set(c.id, c);
    }
  }
  if (anyOk) {
    return { contacts: [...merged.values()], via: "post-filters" };
  }

  const err = new Error(`Search failed (${attempts.join(", ") || "no attempts"})`);
  err.status = 422;
  throw err;
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error } = await requireStaffAuth(context, headers);
    if (error) return error;

    const url = new URL(context.request.url);
    const query = (url.searchParams.get("query") || "").trim();

    if (!query || query.length < 2) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    const { contacts } = await findContacts(context, query);

    let fieldDefs = {};
    try {
      const fieldDefsRes = await ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`);
      if (fieldDefsRes.ok) {
        const fieldDefsData = await fieldDefsRes.json();
        for (const f of fieldDefsData.customFields || []) {
          const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
          if (shortKey) fieldDefs[shortKey] = f.id;
        }
      }
    } catch (err) {
      console.error("[staff-contacts] customFields lookup skipped:", err.message);
    }

    const results = contacts.map((c) => mapContact(c, fieldDefs));
    return new Response(JSON.stringify(results), { status: 200, headers });
  } catch (err) {
    console.error("[staff-contacts] Unexpected error:", err);
    const message = err?.message?.startsWith("Search failed")
      ? err.message
      : "Internal server error";
    const status = err?.status === 422 ? 422 : 500;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
}
