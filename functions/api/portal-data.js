// Cloudflare Pages Function: GET /api/portal-data
// Returns client data from GHL: contact details, appointments, series progress

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { deriveLedger, hydrateOrders } from "../lib/session-ledger.js";

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

// Extract custom field value from GHL contact
// fieldDefs is a map of { [key: string]: string } — field key (short) → field ID
export function getCustomField(contact, fieldKey, fieldDefs = {}) {
  if (!contact.customFields) return null;
  const fieldId = fieldDefs[fieldKey];
  const field = contact.customFields.find(
    (f) =>
      (fieldId && f.id === fieldId) ||
      f.id === fieldKey ||
      f.key === fieldKey ||
      f.key === `contact.${fieldKey}`
  );
  return field ? field.value ?? field.field_value : null;
}

// GHL checkbox fields return either: true (bool), "true" (string), or ["true"] (array)
export function isChecked(raw) {
  if (!raw && raw !== 0) return false;
  if (Array.isArray(raw)) return raw.some(v => ["true","yes","1"].includes(String(v).toLowerCase()));
  return ["true","yes","1"].includes(String(raw).toLowerCase());
}

// 8-session series always includes Living Practice — don't require the field to be set
export function computeHasLivingPractice(lpRaw, tags, seriesType) {
  return isChecked(lpRaw) ||
    (tags || []).includes("living-practice-access") ||
    seriesType === "8-session";
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    const GHL_API_KEY = await getGhlToken(context);

    if (!JWT_SECRET || !GHL_API_KEY) {
      console.error("[portal-data] Missing env vars");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Verify auth token
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers }
      );
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Session expired. Please log in again." }),
        { status: 401, headers }
      );
    }

    const contactId = tokenPayload.contactId;

    // Fetch contact, appointments, custom field defs, orders, and invoices in
    // parallel. The ledger needs orders+invoices in addition to contact+appts;
    // batching them all here avoids a second round-trip. Orders+invoices are
    // optional — if either fails the ledger downgrades confidence but the
    // page still renders.
    const [
      contactResponse,
      appointmentsResponse,
      fieldDefsResponse,
      ordersResponse,
      invoicesResponse,
    ] = await Promise.all([
      fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetch(`${GHL_API_BASE}/contacts/${contactId}/appointments`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetch(`${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetch(
        `${GHL_API_BASE}/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`,
        { headers: ghlHeaders(GHL_API_KEY) },
      ),
      // GHL /invoices/ requires offset as a non-empty string or it 422s
      fetch(
        `${GHL_API_BASE}/invoices/?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`,
        { headers: ghlHeaders(GHL_API_KEY) },
      ),
    ]);

    // Build a map of short field key → field ID (e.g. "sessions_completed" → "TE0udwVH1Km5RsKaN5H0")
    let fieldDefs = {};
    if (fieldDefsResponse.ok) {
      const fieldDefsData = await fieldDefsResponse.json();
      const allFields = fieldDefsData.customFields || [];
      for (const f of allFields) {
        // f.fieldKey is like "contact.sessions_completed" — strip the "contact." prefix
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    if (!contactResponse.ok) {
      console.error(`[portal-data] GHL contact fetch error: ${contactResponse.status}`);
      return new Response(
        JSON.stringify({ error: "Unable to load your data. Please try again." }),
        { status: 422, headers }
      );
    }

    const contactData = await contactResponse.json();
    const contact = contactData.contact;

    // Parse appointments (may fail if contact has none)
    let allAppointments = [];
    if (appointmentsResponse.ok) {
      const apptData = await appointmentsResponse.json();
      allAppointments = apptData.appointments || apptData.events || [];
    }

    // Parse orders + invoices for the ledger derivation. Both are optional —
    // if either fails the ledger downgrades confidence but the page still
    // renders.
    let orders = [];
    if (ordersResponse.ok) {
      const ordersData = await ordersResponse.json();
      const ordersList = ordersData.data || ordersData.orders || [];
      // POS / mobile_app orders come back from LIST without items[];
      // hydrate via /payments/orders/{id} so classifyOrder can read
      // product._id. See session-ledger.js → hydrateOrders for details.
      orders = await hydrateOrders(context, ordersList);
    }
    let invoices = [];
    if (invoicesResponse.ok) {
      const invoicesData = await invoicesResponse.json();
      invoices = invoicesData.invoices || [];
    }

    // Derive the prepaid balance from orders + invoices + appointments. This
    // is the same logic the staff app uses (functions/lib/session-ledger.js);
    // by sharing it, the portal stops depending on the drift-prone GHL
    // custom fields and instead reflects the actual prepaid balance.
    //
    // See projects/amarimethod-website/portal/PORTAL-REDESIGN-RESEARCH.md
    // for full context.
    const ledger = deriveLedger({
      contact,
      orders,
      invoices,
      appointments: allAppointments,
      fieldDefs,
    });

    // Use display values from deriveLedger — falls back to the GHL field
    // when manualLock=true OR confidence="low". See session-ledger.js
    // → display block.
    const seriesType = ledger.display.seriesType;

    // Two distinct counters per UX decision 2026-05-29:
    //   sessionsRemaining — prepaid package balance ("when do I need to act?")
    //   sessionsCompleted — lifetime journey ("how far have I come?")
    // These are independent. They don't sum to a package size.
    const sessionsRemaining = ledger.display.remaining;
    // Lifetime journey count. Per Eben's 2026-06-03 clarification:
    //   - Entrainments count as total sessions
    //   - Phone-style appointments (discovery, consultation, 15-min, pain
    //     assessment) do NOT count
    //   - Neither counts against the package balance (sessions_remaining)
    // Backend regex mirrors NON_JOURNEY_PATTERNS in staff-mark-attended.js
    // and series-reconcile-worker/src/sync.js computeLifetimeCount —
    // keeps all three "lifetime" surfaces consistent.
    const NON_JOURNEY = /pain assessment|discovery call|15-minute|15 minute|consultation/i;
    const lifetimeCompletedCount = allAppointments.filter((a) => {
      const s = (a.appointmentStatus || a.status || "").toLowerCase();
      // Past 'confirmed' appointments effectively ran — Garrett doesn't
      // always flip them to 'completed' or 'showed' after a session.
      if (!(s === "completed" || s === "showed" || s === "confirmed")) return false;
      const title = `${a.title || ""} ${a.calendarName || ""}`;
      return !NON_JOURNEY.test(title);
    }).length;
    const sessionsCompleted = lifetimeCompletedCount;

    // Extra ledger-derived fields for the new two-counter UI:
    const packageSize = ledger.purchased; // total sessions purchased (e.g., 8 for 8-pack, 12 for 4+8)
    // attendedAgainstPackage MUST stay consistent with sessionsRemaining so
    // the portal progress bar (which renders attended/packageSize) doesn't
    // visually disagree with the "N sessions left" text. ledger.display
    // back-computes attended when the lock or low-confidence fallback
    // overrides remaining; use display.attended so the triplet sums to
    // packageSize regardless of which path drove the displayed remaining.
    const attendedAgainstPackage = ledger.display.attended;
    const ledgerConfidence = ledger.confidence; // 'high' | 'low'
    const ledgerSource = ledger.source; // 'orders+invoices+appointments' | 'empty'

    const lpRaw = getCustomField(contact, "living_practice_access", fieldDefs);
    const paRaw = getCustomField(contact, "portal_access", fieldDefs);
    const hasLivingPractice = computeHasLivingPractice(lpRaw, contact.tags || [], seriesType);
    const portalAccess = isChecked(paRaw) || (contact.tags || []).includes("portal-access");
    const isPartner = (contact.tags || []).includes("affiliate-partner");

    const referralCountRaw = getCustomField(contact, "client_referral_count", fieldDefs);
    const referralCount = Math.max(0, parseInt(referralCountRaw ?? "0", 10) || 0);
    const rewardCode = getCustomField(contact, "referral_reward_code", fieldDefs) || null;

    // Sort appointments by date
    const nowMs = Date.now();
    // Pull the meeting URL out of whatever GHL field carries it for this
    // appointment. GHL stores Google Meet links in `address`, `meetingLocation`,
    // or `meeting_location` depending on calendar config and API version.
    function extractMeetingUrl(appt) {
      const candidates = [
        appt.address,
        appt.meetingLocation,
        appt.meeting_location,
        appt.location,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
      }
      return null;
    }

    const sortedAppointments = allAppointments
      .map((appt) => ({
        id: appt.id,
        title: appt.title || appt.calendarName || "Session",
        startTime: appt.startTime || appt.start_time,
        endTime: appt.endTime || appt.end_time,
        status: (appt.appointmentStatus || appt.status || "confirmed").toLowerCase(),
        appointmentType: appt.calendarName || appt.title || "Session",
        meetingUrl: extractMeetingUrl(appt),
      }))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    // Split into past and upcoming
    const pastAppointments = sortedAppointments.filter((a) => {
      const ms = new Date(a.startTime).getTime();
      return Number.isFinite(ms) && ms < nowMs;
    });
    const upcomingAppointments = sortedAppointments
      .filter((a) => {
        const ms = new Date(a.startTime).getTime();
        return Number.isFinite(ms) && ms >= nowMs && a.status !== "cancelled";
      })
      .reverse(); // Soonest first for upcoming

    // Capitalize first letter of names
    const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

    return new Response(
      JSON.stringify({
        client: {
          contactId: contact.id,
          firstName: capitalize(contact.firstName) || "there",
          lastName: capitalize(contact.lastName) || "",
          email: contact.email || tokenPayload.email,
          phone: contact.phone || undefined,
          seriesType,
          sessionsCompleted,
          sessionsRemaining,
          // ── New ledger-derived fields (2026-05-29 portal redesign) ──
          packageSize,
          attendedAgainstPackage,
          ledgerConfidence,
          ledgerSource,
          hasLivingPractice,
          portalAccess,
          isPartner,
          referralCount,
          rewardCode,
        },
        appointments: pastAppointments,
        upcomingAppointments,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[portal-data] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
