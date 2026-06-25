// Cloudflare Pages Function: GET /api/staff-pipeline
// Returns all contacts bucketed into 11 Kanban columns representing
// the full Amari lifecycle: Touch 1-6 → Discovery → First Session → Pack 1-3+
// Eben's private pipeline view — staff auth required.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Internal contacts excluded from the pipeline view
const EXCLUDED_EMAILS = new Set(["eben@ebenforrest.com"]);

// GHL custom field IDs — hardcoded to avoid dynamic map lookup failures
const FIELD_IDS = {
  touch_count:         "qKtPT2XZP61emgUDK7fd",
  series_type:         "3i93lTkmuAV49s9nh0q8",
  sessions_completed:  "TE0udwVH1Km5RsKaN5H0",
  sessions_remaining:  "wrQSkx6BhXwDGIn1d0V4",
};

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
  "booked discovery call - workflow 2",
  "booked-discovery-call",
  "quiz submitted",
  "referred-a-client",
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

function readFieldById(contact, fieldId) {
  const arr = contact.customFields || [];
  const entry = arr.find((f) => f.id === fieldId);
  const v = entry?.value ?? entry?.field_value;
  return v === "" || v === null || v === undefined ? null : v;
}

function getTouchCount(contact) {
  return parseInt(readFieldById(contact, FIELD_IDS.touch_count) ?? "0", 10) || 0;
}

function getSessionsCompleted(contact) {
  return parseInt(readFieldById(contact, FIELD_IDS.sessions_completed) ?? "0", 10) || 0;
}

function getSessionsRemaining(contact) {
  return parseInt(readFieldById(contact, FIELD_IDS.sessions_remaining) ?? "0", 10) || 0;
}

function getSeriesType(contact) {
  return (readFieldById(contact, FIELD_IDS.series_type) || "none").toLowerCase();
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

function assignColumn(contact, discoveryStatusMap, sessionAttendanceMap) {
  const tags = getTags(contact);
  const touchCount = getTouchCount(contact);
  const attendance = sessionAttendanceMap[contact.id] || { showed: 0, hasPackage: false };

  // Referred clients get their own column — highest priority
  if (tags.includes("referred-a-client")) return "referred";

  // Session columns — use real appointment attendance data
  if (attendance.showed > 8) return "multipack-2";
  if (attendance.hasPackage && attendance.showed >= 1) return "multipack-1";
  if (attendance.showed >= 1) return "first-session";
  if (tags.includes("booked discovery call - workflow 2") || tags.includes("booked-discovery-call")) {
    const apptStatus = discoveryStatusMap[contact.id];
    if (apptStatus === undefined) {
      // Tag exists but no appointment record — fall through to touch columns
    } else if (apptStatus === "noshow" || apptStatus === "cancelled" || tags.includes("discovery-no-show")) {
      return "discovery-noshow";
    } else {
      return "discovery";
    }
  }

  // Touch columns — only show contacts active in last 6 months
  const lastActivity = getLastActivity(contact);
  if (lastActivity < Date.now() - SIX_MONTHS_MS) return null;

  if (touchCount >= 6) return "touch-6";
  if (touchCount === 5) return "touch-5";
  if (touchCount === 4) return "touch-4";
  if (touchCount === 3) return "touch-3";
  if (touchCount === 2) return "touch-2";
  if (touchCount >= 1) return "touch-1";
  return null; // never contacted — not on the board yet
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
// All session calendars — initial + follow-up, in-person + virtual + partner
const SESSION_CALENDARS = [
  "G7OAnnJuFbMF6nQSlZVQ", // Initial Session — In Person
  "ySmht5hx4uZGEpgZrlCw", // Initial Session — Virtual
  "uUDFD0ZQEWtzGLS9aLq7", // Initial Session — Paid at Partner
  "lfsnaiGiLNL2z12pLKDP", // Partner Initial Session
  "P7T6M1w8wtuRfwAqzOVw", // Partner Initial Session - Virtual
  "SKDVOL8wtUN6Ne0ppbC9", // Follow-up Session — In Person
  "ZO1jlGfy01rsxVqicoSB", // Follow-up Session — In Person (Package)
  "bJFkhVP35Ecwh4tLnSmy", // Follow-up Session — Virtual (Package)
  "oVn77FcecFY16iS2pHyP", // Follow-up Session — Virtual
];

// Any follow-up calendar = bought a series (follow-ups require a pack)
const PACKAGE_CALENDAR_IDS = new Set([
  "SKDVOL8wtUN6Ne0ppbC9", // Follow-up Session — In Person
  "ZO1jlGfy01rsxVqicoSB", // Follow-up Session — In Person (Package)
  "bJFkhVP35Ecwh4tLnSmy", // Follow-up Session — Virtual (Package)
  "oVn77FcecFY16iS2pHyP", // Follow-up Session — Virtual
]);

async function fetchSessionAttendance(ghlToken) {
  const start = new Date("2024-01-01").getTime();
  const end = new Date("2028-01-01").getTime();
  // contactId → { showed: number, hasPackage: boolean }
  const map = {};
  await Promise.all(SESSION_CALENDARS.map(async (calId) => {
    const res = await fetch(
      `${GHL_API_BASE}/calendars/events?locationId=${GHL_LOCATION_ID}&calendarId=${calId}&startTime=${start}&endTime=${end}`,
      { headers: ghlHeaders(ghlToken) }
    );
    if (!res.ok) return;
    const data = await res.json();
    for (const appt of (data.appointments || data.events || [])) {
      if (appt.appointmentStatus !== "showed") continue;
      const cId = appt.contactId;
      if (!cId) continue;
      if (!map[cId]) map[cId] = { showed: 0, hasPackage: false };
      map[cId].showed += 1;
      if (PACKAGE_CALENDAR_IDS.has(calId)) map[cId].hasPackage = true;
    }
  }));
  return map;
}

async function fetchDiscoveryStatus(ghlToken) {
  const start = new Date("2024-01-01").getTime();
  const end = new Date("2028-01-01").getTime();
  const calIds = ["USgPsktqRcuomdUgpShL", "ZEIGFHBi17SpZ3Ezi5DR"];
  const statusMap = {};
  await Promise.all(calIds.map(async (calId) => {
    const res = await fetch(
      `${GHL_API_BASE}/calendars/events?locationId=${GHL_LOCATION_ID}&calendarId=${calId}&startTime=${start}&endTime=${end}`,
      { headers: ghlHeaders(ghlToken) }
    );
    if (!res.ok) return;
    const data = await res.json();
    for (const appt of (data.appointments || data.events || [])) {
      const cId = appt.contactId;
      if (!cId) continue;
      // "showed" wins over anything else; otherwise keep the most recent
      if (!statusMap[cId] || appt.appointmentStatus === "showed") {
        statusMap[cId] = appt.appointmentStatus;
      }
    }
  }));
  return statusMap;
}

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

  // Four fetches in parallel:
  // 1. Outreach-tagged contacts (for touch/discovery columns)
  // 2. All contacts — to catch clients with no outreach tags
  // 3. Discovery calendar appointment statuses (showed/noshow/cancelled)
  // 4. Session attendance from all session calendars — source of truth for column placement
  const [tagResults, allContacts, discoveryStatusMap, sessionAttendanceMap] = await Promise.all([
    Promise.all(OUTREACH_TAGS.map((tag) => fetchByTag(ghlToken, tag).catch(() => []))),
    fetchAllContacts(ghlToken).catch(() => []),
    fetchDiscoveryStatus(ghlToken).catch(() => ({})),
    fetchSessionAttendance(ghlToken).catch(() => ({})),
  ]);

  // Merge: outreach contacts first, then anyone with sessions who wasn't already included
  const byId = new Map();
  for (const list of tagResults) {
    for (const c of list) {
      if (EXCLUDED_EMAILS.has(c.email)) continue;
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
  for (const c of allContacts) {
    if (EXCLUDED_EMAILS.has(c.email)) continue;
    if (byId.has(c.id)) continue;
    // Include anyone with real session attendance, regardless of custom field state
    if (sessionAttendanceMap[c.id]?.showed > 0) byId.set(c.id, c);
  }

  // Bucket into columns
  const columns = {
    "touch-1": [],
    "touch-2": [],
    "touch-3": [],
    "touch-4": [],
    "touch-5": [],
    "touch-6": [],
    "discovery-noshow": [],
    discovery: [],
    "first-session": [],
    "multipack-1": [],
    "multipack-2": [],
    referred: [],
  };

  for (const contact of byId.values()) {
    const col = assignColumn(contact, discoveryStatusMap, sessionAttendanceMap);
    if (!col) continue; // stale — outside 6-month window, no sessions

    const attendance = sessionAttendanceMap[contact.id] || { showed: 0, hasPackage: false };
    const touchCount = getTouchCount(contact);

    columns[col].push({
      id: contact.id,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "(no name)",
      touchCount,
      sessionsCompleted: attendance.showed,
      sessionsRemaining: getSessionsRemaining(contact),
      seriesType: attendance.hasPackage ? "series" : "none",
      lastActivity: contact.lastActivity || contact.dateUpdated || null,
      dateAdded: contact.dateAdded || null,
    });
  }

  // Sort: session columns by sessions desc, touch columns by touchCount desc then name
  for (const col of Object.keys(columns)) {
    if (["first-session", "multipack-1", "multipack-2"].includes(col)) {
      columns[col].sort((a, b) => b.sessionsCompleted - a.sessionsCompleted);
    } else {
      columns[col].sort((a, b) => b.touchCount - a.touchCount || a.name.localeCompare(b.name));
    }
  }

  return new Response(JSON.stringify({ columns }), { status: 200, headers });
}
