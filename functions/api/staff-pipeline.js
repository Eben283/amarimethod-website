// Cloudflare Pages Function: GET /api/staff-pipeline
// Returns all contacts bucketed into 11 Kanban columns representing
// the full Amari lifecycle: Touch 1-6 → Discovery → First Session → Pack 1-3+
// Eben's private pipeline view — staff auth required.

import { ghlFetch, ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "./portal-data.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// GHL custom field ID for outbound touch count (partner_touch_count)
const TOUCH_COUNT_FIELD_ID = "qKtPT2XZP61emgUDK7fd";

// Tags that indicate a contact is in the outreach or client pipeline.
// Must match actual GHL tag names exactly (sourced from staff-partner-prospects.js).
const OUTREACH_TAGS = [
  "golf-new-partner",
  "tennis-new-partner",
  "trainer-new-partner",
  "trainer-outreach",
  "business-new-partner",
  "therapist-new-partner",
  "mental-health-prospect",
  "partner-prospect",
  "affiliate-partner",
  "ambassador-prospect",
  "discovery call attended",
  "quiz submitted",
];

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
  "http://localhost:5175",
  "http://localhost:5174",
  "http://localhost:5173",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function getTouchCount(contact) {
  const vals = contact.customValues || contact.customFields || [];
  const entry = vals.find((f) => f.id === TOUCH_COUNT_FIELD_ID);
  return parseInt(entry?.value ?? "0", 10) || 0;
}

function assignColumn(contact, fieldDefs) {
  const sessionsCompleted = parseInt(
    getCustomField(contact, "sessions_completed", fieldDefs) ?? "0",
    10
  );
  const seriesType = (
    getCustomField(contact, "series_type", fieldDefs) || "none"
  ).toLowerCase();
  const tags = (contact.tags || []).map((t) =>
    (typeof t === "string" ? t : t.name || "").toLowerCase()
  );
  const touchCount = getTouchCount(contact);

  // Client columns — most advanced milestone wins
  if (sessionsCompleted >= 17) return "multipack-3";
  if (sessionsCompleted >= 9) return "multipack-2";
  if (seriesType !== "none" && sessionsCompleted >= 1) return "multipack-1";
  if (sessionsCompleted >= 1) return "first-session";
  if (tags.includes("discovery call attended")) return "discovery";

  // Touch columns — based on outbound contact count
  if (touchCount >= 6) return "touch-6";
  if (touchCount === 5) return "touch-5";
  if (touchCount === 4) return "touch-4";
  if (touchCount === 3) return "touch-3";
  if (touchCount === 2) return "touch-2";
  return "touch-1";
}

async function fetchByTag(ghlToken, tag) {
  const all = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        pageLimit: 100,
        page,
        filters: [{ field: "tags", operator: "contains", value: tag }],
      }),
    });
    if (!res.ok) break;
    const data = await res.json();
    const contacts = data.contacts || [];
    all.push(...contacts);
    if (contacts.length < 100) break;
    page += 1;
  }
  return all;
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

  const JWT_SECRET = context.env.JWT_SECRET;
  if (!JWT_SECRET) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), { status: 500, headers });
  }

  const authHeader = context.request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
  }

  let tokenPayload;
  try {
    tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers });
  }
  if (tokenPayload.role !== "staff") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
  }

  const ghlToken = await getGhlToken(context);
  if (!ghlToken) {
    return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });
  }

  // Fetch custom field definitions for getCustomField key lookups
  let fieldDefs = [];
  try {
    const defsRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`
    );
    if (defsRes.ok) {
      const defsData = await defsRes.json();
      fieldDefs = defsData.customFields || [];
    }
  } catch {
    // non-fatal — field lookups fall back to empty string
  }

  // Fetch contacts across all relevant outreach tags in parallel, dedupe by ID
  const tagResults = await Promise.all(
    OUTREACH_TAGS.map((tag) => fetchByTag(ghlToken, tag).catch(() => []))
  );
  const byId = new Map();
  for (const list of tagResults) {
    for (const c of list) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }

  // Bucket contacts into columns
  const columns = {
    "touch-1": [],
    "touch-2": [],
    "touch-3": [],
    "touch-4": [],
    "touch-5": [],
    "touch-6": [],
    discovery: [],
    "first-session": [],
    "multipack-1": [],
    "multipack-2": [],
    "multipack-3": [],
  };

  for (const contact of byId.values()) {
    const col = assignColumn(contact, fieldDefs);
    const sessionsCompleted = parseInt(
      getCustomField(contact, "sessions_completed", fieldDefs) ?? "0",
      10
    );
    const sessionsRemaining = parseInt(
      getCustomField(contact, "sessions_remaining", fieldDefs) ?? "0",
      10
    );
    const seriesType = (
      getCustomField(contact, "series_type", fieldDefs) || ""
    ).toLowerCase();
    const touchCount = getTouchCount(contact);

    columns[col].push({
      id: contact.id,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "(no name)",
      touchCount,
      sessionsCompleted,
      sessionsRemaining,
      seriesType,
      lastActivity: contact.lastActivity || contact.dateUpdated || null,
    });
  }

  // Sort each column: clients by sessions desc, prospects by touchCount desc then name
  for (const col of Object.keys(columns)) {
    if (["multipack-1", "multipack-2", "multipack-3", "first-session"].includes(col)) {
      columns[col].sort((a, b) => b.sessionsCompleted - a.sessionsCompleted);
    } else {
      columns[col].sort((a, b) => b.touchCount - a.touchCount || a.name.localeCompare(b.name));
    }
  }

  return new Response(JSON.stringify({ columns }), { status: 200, headers });
}
