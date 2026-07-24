// Cloudflare Pages Function: GET /api/staff-pipeline
// Returns all contacts bucketed into 11 Kanban columns representing
// the full Amari lifecycle: Touch 1-6 → Discovery → First Session → Pack 1-3+
// Eben's private pipeline view — staff auth required.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../lib/ghl-fields.js";
import { classifyCharge } from "../lib/stripe-charges.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Internal contacts excluded from the pipeline view
const EXCLUDED_EMAILS = new Set(["eben@ebenforrest.com"]);

// GHL custom field IDs — hardcoded to avoid dynamic map lookup failures.
// Money/session IDs single-sourced from lib/ghl-fields.js; touch_count is a
// partner-CRM field not yet covered by the registry (follow-up).
const FIELD_IDS = {
  touch_count:         "qKtPT2XZP61emgUDK7fd",
  series_type:         GHL_FIELD_IDS.series_type,
  sessions_completed:  GHL_FIELD_IDS.sessions_completed,
  sessions_remaining:  GHL_FIELD_IDS.sessions_remaining,
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

function assignColumn(contact, discoveryStatusMap, sessionAttendanceMap, purchasesByContact) {
  const tags = getTags(contact);
  const touchCount = getTouchCount(contact);
  const attendance = sessionAttendanceMap[contact.id] || { showed: 0, noShow: false, hasPackage: false };
  const purchases = purchasesByContact.get(contact.id)?.count || 0;

  // Purchase stages are based on successful Stripe charges, rather than a
  // package-size/session-count proxy. A 2-session purchase is still a first
  // purchase; two distinct charges are a repeat purchase.
  if (purchases >= 2) return "multipack-2";
  if (purchases === 1) return "multipack-1";
  if (attendance.showed >= 1) return "first-session";
  if (attendance.noShow) return "session-noshow";

  // Discovery — driven by appointment data; no tag required
  const discoveryApptStatus = discoveryStatusMap[contact.id];
  if (discoveryApptStatus !== undefined) {
    if (discoveryApptStatus === "noshow" || discoveryApptStatus === "cancelled" || tags.includes("discovery-no-show")) {
      return "discovery-noshow";
    }
    if (discoveryApptStatus === "showed" || discoveryApptStatus === "completed") return "discovery";
    // A scheduled discovery call has not yet reached a completed pipeline
    // stage. Keep the person in their outreach-touch column until it happens.
  }
  // Has booking tag but no appointment record → fall through to touch columns
  // (e.g., clicked booking link but didn't complete the booking)

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
  while (page <= 20) {
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
  // contactId → { showed: number, noShow: boolean, hasPackage: boolean }
  const map = {};
  await Promise.all(SESSION_CALENDARS.map(async (calId) => {
    const res = await fetch(
      `${GHL_API_BASE}/calendars/events?locationId=${GHL_LOCATION_ID}&calendarId=${calId}&startTime=${start}&endTime=${end}`,
      { headers: ghlHeaders(ghlToken) }
    );
    if (!res.ok) return;
    const data = await res.json();
    for (const appt of (data.appointments || data.events || [])) {
      const cId = appt.contactId;
      if (!cId) continue;
      if (!map[cId]) map[cId] = { showed: 0, noShow: false, hasPackage: false };
      if (appt.appointmentStatus === "showed" || appt.appointmentStatus === "completed") {
        map[cId].showed += 1;
        if (PACKAGE_CALENDAR_IDS.has(calId)) map[cId].hasPackage = true;
      } else if (appt.appointmentStatus === "noshow") {
        map[cId].noShow = true;
      }
    }
  }));
  return map;
}

async function fetchDiscoveryStatus(ghlToken) {
  const start = new Date("2024-01-01").getTime();
  const end = new Date("2028-01-01").getTime();
  const calIds = [
    "USgPsktqRcuomdUgpShL", // Discovery Call — In Person
    "ZEIGFHBi17SpZ3Ezi5DR", // Discovery Call — Virtual
    "aVE54Qf4lrbYTB0zFqXy", // 15-Minute Pain Assessment / Ambassador Prospect Call
  ];
  const statusMap = {};
  const events = [];
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
      events.push({
        contactId: cId,
        status: String(appt.appointmentStatus || "").toLowerCase(),
        date: new Date(appt.startTime || appt.dateAdded || 0).toISOString().slice(0, 10),
      });
      // "showed" wins over anything else; otherwise keep the most recent
      if (!statusMap[cId] || appt.appointmentStatus === "showed") {
        statusMap[cId] = appt.appointmentStatus;
      }
    }
  }));
  return { statusMap, events };
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

async function fetchStripePurchaseHistory(stripeKey, contacts = []) {
  const purchases = new Map();
  if (!stripeKey) return purchases;

  const charges = [];
  let cursor = null;
  // The practice has a small charge volume; paginate defensively in case the
  // account has grown beyond one Stripe page.
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("starting_after", cursor);
    const res = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!res.ok) break;
    const payload = await res.json();
    const batch = payload.data || [];
    charges.push(...batch);
    if (!payload.has_more || batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
  }

  // Payment-link charges identify their GHL contact directly. Invoice/POS
  // charges commonly omit that field, so also match their billing/receipt email
  // to GHL and then carry that identity across the Stripe customer record.
  const contactByEmail = new Map(
    contacts
      .filter((contact) => contact.email)
      .map((contact) => [String(contact.email).trim().toLowerCase(), contact.id]),
  );
  const contactForCharge = (charge) => {
    if (charge.metadata?.contactId) return charge.metadata.contactId;
    const email = charge.billing_details?.email || charge.receipt_email;
    return email ? contactByEmail.get(String(email).trim().toLowerCase()) : null;
  };
  const customerToContact = new Map();
  for (const charge of charges) {
    const contactId = contactForCharge(charge);
    if (contactId && charge.customer) customerToContact.set(charge.customer, contactId);
  }
  for (const charge of charges) {
    if (!charge.paid || charge.status !== "succeeded" || charge.refunded) continue;
    if ((charge.amount || 0) <= (charge.amount_refunded || 0)) continue;
    const classified = classifyCharge(charge);
    // Only session-bearing charges define a care purchase. Entrainment and
    // unknown products remain out rather than being guessed into this funnel.
    if (!classified.sessions || classified.sessions <= 0) continue;
    const contactId = contactForCharge(charge) || customerToContact.get(charge.customer);
    if (!contactId) continue;
    const prior = purchases.get(contactId) || { count: 0, sessionsPurchased: 0, dates: [] };
    prior.count += 1;
    prior.sessionsPurchased += classified.sessions;
    prior.dates.push(new Date((charge.created || 0) * 1000).toISOString().slice(0, 10));
    purchases.set(contactId, prior);
  }
  return purchases;
}

function buildCohortMetrics(snapshot, discoveryEvents, purchasesByContact) {
  const blank = { reachedOut: 0, discoveryAttended: 0, initialResolved: 0, initialAttended: 0, initialNoShows: 0, firstPurchasers: 0, repeatPurchasers: 0 };
  if (!snapshot) return blank;
  const windowStart = snapshot.generatedAt
    ? new Date(new Date(snapshot.generatedAt).getTime() - (snapshot.windowDays || 180) * 86_400_000).toISOString().slice(0, 10)
    : "";
  const outreachIds = new Set(
    (snapshot.calls || []).filter((event) => event.contactId).map((event) => event.contactId),
  );
  const discoveryAttended = new Set(
    (discoveryEvents || [])
      .filter((event) => ["showed", "completed"].includes(event.status) && event.date >= windowStart && outreachIds.has(event.contactId))
      .map((event) => event.contactId),
  );
  const sessions = (snapshot.sessions || []).filter((event) => event.contactId && ["attended", "noshow"].includes(event.status));
  const attended = sessions.filter((event) => event.status === "attended");
  const noShows = sessions.filter((event) => event.status === "noshow");
  const firstPurchasers = new Set();
  const repeatPurchasers = new Set();
  for (const session of attended) {
    const dates = (purchasesByContact.get(session.contactId)?.dates || []).filter((date) => date >= session.sessionDate).sort();
    if (dates.length >= 1) firstPurchasers.add(session.contactId);
    if (dates.length >= 2) repeatPurchasers.add(session.contactId);
  }
  return {
    reachedOut: outreachIds.size,
    discoveryAttended: discoveryAttended.size,
    initialResolved: sessions.length,
    initialAttended: attended.length,
    initialNoShows: noShows.length,
    firstPurchasers: firstPurchasers.size,
    repeatPurchasers: repeatPurchasers.size,
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

  const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
  if (error) return error;


  const ghlToken = await getGhlToken(context);
  if (!ghlToken) {
    return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });
  }

  // Five fetches in parallel:
  // 1. Outreach-tagged contacts (for touch/discovery columns)
  // 2. All contacts — to catch clients with no outreach tags
  // 3. Discovery calendar appointment statuses (showed/noshow/cancelled)
  // 4. Session attendance from all session calendars
  // 5. Successful Stripe charges — source of truth for purchase count
  const [tagResults, allContacts, discoveryData, sessionAttendanceMap, funnelSnapshot] = await Promise.all([
    Promise.all(OUTREACH_TAGS.map((tag) => fetchByTag(ghlToken, tag).catch(() => []))),
    fetchAllContacts(ghlToken).catch(() => []),
    fetchDiscoveryStatus(ghlToken).catch(() => ({ statusMap: {}, events: [] })),
    fetchSessionAttendance(ghlToken).catch(() => ({})),
    context.env.PORTAL_KV?.get("funnel:latest", "json").catch(() => null),
  ]);
  const purchasesByContact = await fetchStripePurchaseHistory(context.env.STRIPE_SECRET_KEY, allContacts).catch(() => new Map());
  const discoveryStatusMap = discoveryData.statusMap;
  const cohortMetrics = buildCohortMetrics(funnelSnapshot, discoveryData.events, purchasesByContact);

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
    // Include anyone with a completed or no-show session, regardless of outreach tags.
    const attendance = sessionAttendanceMap[c.id];
    if (attendance?.showed > 0 || attendance?.noShow) byId.set(c.id, c);
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
    "session-noshow": [],
    discovery: [],
    "first-session": [],
    "multipack-1": [],
    "multipack-2": [],
  };

  for (const contact of byId.values()) {
    const col = assignColumn(contact, discoveryStatusMap, sessionAttendanceMap, purchasesByContact);
    if (!col) continue; // stale — outside 6-month window, no sessions

    const attendance = sessionAttendanceMap[contact.id] || { showed: 0, noShow: false, hasPackage: false };
    const touchCount = getTouchCount(contact);
    const purchase = purchasesByContact.get(contact.id) || { count: 0, sessionsPurchased: 0 };
    const hasSentReferral = getTags(contact).includes("referred-a-client");

    columns[col].push({
      id: contact.id,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "(no name)",
      touchCount,
      sessionsCompleted: attendance.showed,
      sessionsRemaining: getSessionsRemaining(contact),
      seriesType: attendance.hasPackage ? "series" : "none",
      purchaseCount: purchase.count,
      sessionsPurchased: purchase.sessionsPurchased,
      hasSentReferral,
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

  return new Response(JSON.stringify({ columns, cohortMetrics }), { status: 200, headers });
}
