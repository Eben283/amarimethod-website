// Cloudflare Pages Function: GET /api/staff-pipeline
// Returns all contacts bucketed into 11 Kanban columns representing
// the full Amari lifecycle: Touch 1-6 → Discovery → First Session → Pack 1-3+
// Eben's private pipeline view — staff auth required.

import { ghlFetch, ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// GHL custom field ID for outbound touch count (partner_touch_count)
const TOUCH_COUNT_FIELD_ID = "qKtPT2XZP61emgUDK7fd";

// 6 months ago cutoff for touch columns — older contacts drop off
const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

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

// Read a custom field by its field key, using fieldDefsMap = { [fieldKey]: fieldId }.
// Falls back to matching by key name on the contact's customFields array directly.
function readField(contact, fieldKey, fieldDefsMap) {
  const arr = contact.customFields || [];
  const fieldId = fieldDefsMap[fieldKey];
  const entry = arr.find(
    (f) =>
      (fieldId && f.id === fieldId) ||
      f.key === fieldKey ||
      f.key === `contact.${fieldKey}`
  );
  const v = entry?.value ?? entry?.field_value;
  return v === "" || v === null || v === undefined ? null : v;
}

function getTouchCount(contact) {
  const arr = contact.customFields || [];
  const entry = arr.find((f) => f.id === TOUCH_COUNT_FIELD_ID);
  return parseInt(entry?.value ?? "0", 10) || 0;
}

function getSessionsCompleted(contact, fieldDefsMap) {
  return parseInt(readField(contact, "sessions_completed", fieldDefsMap) ?? "0", 10) || 0;
}

function getSeriesType(contact, fieldDefsMap) {
  return (readField(contact, "series_type", fieldDefsMap) || "none").toLowerCase();
}

function getTags(contact) {
  return (contact.tags || []).map((t) =>
    (typeof t === "string" ? t : t.name || "").toLowerCase()
  );
}

function getLastActivity(contact) {
  const raw = contact.lastActivity || contact.dateUpdated || null;
  return raw ? new Date(raw).getTime() : 0;
}

function assignColumn(contact, fieldDefsMap) {
  const sessionsCompleted = getSessionsCompleted(contact, fieldDefsMap);
  const seriesType = getSeriesType(contact, fieldDefsMap);
  const tags = getTags(contact);
  const touchCount = getTouchCount(contact);

  // Session columns take priority over touch columns
  if (sessionsCompleted >= 17) return "multipack-3";
  if (sessionsCompleted >= 9) return "multipack-2";
  if (seriesType !== "none" && sessionsCompleted >= 1) return "multipack-1";
  if (sessionsCompleted >= 1) return "first-session";
  if (tags.includes("discovery call attended")) return "discovery";

  // Touch columns — only show contacts active in last 6 months
  const lastActivity = getLastActivity(contact);
  if (lastActivity < Date.now() - SIX_MONTHS_MS) return null;

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

// Paginated fetch of all contacts — needed to find clients who have no outreach tags.
// Mirrors what staff-balances does. Capped at 10 pages (1000 contacts).
async function fetchAllContacts(ghlToken) {
  const all = [];
  let page = 1;
  while (page <= 10) {
    const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        pageLimit: 100,
        page,
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

  // Fetch field definitions and build { fieldKey: fieldId } map for readField()
  let fieldDefsMap = {};
  try {
    const defsRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`
    );
    if (defsRes.ok) {
      const defsData = await defsRes.json();
      for (const f of defsData.customFields || []) {
        const key = f.fieldKey || f.key;
        if (key) fieldDefsMap[key] = f.id;
      }
    }
  } catch {
    // non-fatal
  }

  // Two fetches in parallel:
  // 1. Outreach-tagged contacts (for touch/discovery columns)
  // 2. All contacts — filtered to those with sessions_completed > 0 (for session columns)
  const [tagResults, allContacts] = await Promise.all([
    Promise.all(OUTREACH_TAGS.map((tag) => fetchByTag(ghlToken, tag).catch(() => []))),
    fetchAllContacts(ghlToken).catch(() => []),
  ]);

  // Merge: outreach contacts first, then anyone with sessions who wasn't already included
  const byId = new Map();
  for (const list of tagResults) {
    for (const c of list) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
  for (const c of allContacts) {
    if (byId.has(c.id)) continue; // already have them from tag fetch
    const sessionsCompleted = getSessionsCompleted(c, fieldDefsMap);
    if (sessionsCompleted > 0) byId.set(c.id, c);
  }

  // Bucket into columns
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
    const col = assignColumn(contact, fieldDefsMap);
    if (!col) continue; // stale — outside 6-month window, no sessions

    const sessionsCompleted = getSessionsCompleted(contact, fieldDefsMap);
    const sessionsRemaining = parseInt(
      readField(contact, "sessions_remaining", fieldDefsMap) ?? "0",
      10
    ) || 0;
    const seriesType = getSeriesType(contact, fieldDefsMap);
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

  // Sort: session columns by sessions desc, touch columns by touchCount desc then name
  for (const col of Object.keys(columns)) {
    if (["first-session", "multipack-1", "multipack-2", "multipack-3"].includes(col)) {
      columns[col].sort((a, b) => b.sessionsCompleted - a.sessionsCompleted);
    } else {
      columns[col].sort((a, b) => b.touchCount - a.touchCount || a.name.localeCompare(b.name));
    }
  }

  return new Response(JSON.stringify({ columns }), { status: 200, headers });
}
