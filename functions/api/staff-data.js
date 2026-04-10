// Cloudflare Pages Function: GET /api/staff-data
// Returns today's appointments with enriched contact data

import { ghlHeaders, getGhlToken, ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "./portal-data.js";
import { deriveLedger } from "../lib/session-ledger.js";

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

    // Verify staff auth token
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

    const GHL_API_KEY = await getGhlToken(context);

    // Support ?date=YYYY-MM-DD and ?endDate=YYYY-MM-DD for ranges
    const url = new URL(context.request.url);
    const dateParam = url.searchParams.get('date');
    const endDateParam = url.searchParams.get('endDate');
    const now = new Date();
    const pacificFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const startDateStr = dateParam && dateRegex.test(dateParam) ? dateParam : pacificFormatter.format(now);
    const endDateStr = endDateParam && dateRegex.test(endDateParam) ? endDateParam : startDateStr;

    // Convert to epoch ms range (handles PST/PDT automatically)
    function dateToEpochRange(dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const probe = new Date(Date.UTC(y, m - 1, d, 20, 0, 0));
      const ptHour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false }).format(probe)
      );
      const utcMidnight = 20 - ptHour;
      const start = Date.UTC(y, m - 1, d, utcMidnight, 0, 0);
      return { start, end: start + 86_400_000 - 1 };
    }
    const rangeStart = dateToEpochRange(startDateStr);
    const rangeEnd = dateToEpochRange(endDateStr);
    const startTime = rangeStart.start;
    const endTime = rangeEnd.end;

    // Fetch all calendars, then query each one for today's events (GHL requires calendarId per request)
    const calendarsRes = await ghlFetch(context, `${GHL_API_BASE}/calendars/?locationId=${GHL_LOCATION_ID}`);
    if (!calendarsRes.ok) {
      console.error(`[staff-data] Calendars list error: ${calendarsRes.status}`);
      return new Response(JSON.stringify({ error: "Failed to load calendars" }), { status: 422, headers });
    }
    const calendarsData = await calendarsRes.json();
    const allCalendars = calendarsData.calendars || [];

    const eventMap = new Map();
    for (const cal of allCalendars) {
      const params = new URLSearchParams({
        locationId: GHL_LOCATION_ID,
        calendarId: cal.id,
        startTime: String(startTime),
        endTime: String(endTime),
      });
      const calResponse = await ghlFetch(context, `${GHL_API_BASE}/calendars/events?${params}`);
      if (calResponse.ok) {
        const calData = await calResponse.json();
        for (const e of (calData.events || [])) {
          if (!eventMap.has(e.id)) {
            eventMap.set(e.id, { ...e, calendarName: cal.name });
          }
        }
      }
    }
    const events = Array.from(eventMap.values());

    // Filter to non-cancelled appointments
    const todayEvents = events.filter(
      (e) => (e.appointmentStatus || e.status || "").toLowerCase() !== "cancelled"
    );

    // Sort chronologically
    todayEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Fetch custom field definitions
    const fieldDefsResponse = await ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`);
    let fieldDefs = {};
    if (fieldDefsResponse.ok) {
      const fieldDefsData = await fieldDefsResponse.json();
      for (const f of (fieldDefsData.customFields || [])) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    // Enrich each appointment with contact details
    const enriched = await Promise.all(
      todayEvents.map(async (event) => {
        const contactId = event.contactId;
        let contactName = event.title || "Unknown";
        let sessionsRemaining = 0;
        let sessionsCompleted = 0;
        let seriesType = "none";
        let tags = [];
        let sessionPrepaid = false;

        if (contactId) {
          try {
            const capitalize = (s) => s ? s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : "";
            const [contactRes, apptRes, ordersRes] = await Promise.all([
              ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
              ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
              ghlFetch(context, `${GHL_API_BASE}/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=50`),
            ]);

            let contact = null;
            if (contactRes.ok) {
              const contactData = await contactRes.json();
              contact = contactData.contact;
              const firstName = capitalize(contact.firstName || "");
              const lastName = capitalize(contact.lastName || "");
              contactName = [firstName, lastName].filter(Boolean).join(" ") || contactName;
              tags = contact.tags || [];
            }

            const orders = ordersRes.ok ? ((await ordersRes.json()).data || []) : [];
            let appointments = [];
            if (apptRes.ok) {
              const apptData = await apptRes.json();
              appointments = apptData.appointments || apptData.events || [];
            }

            const ledger = deriveLedger({
              contact: contact || { customFields: [] },
              orders,
              appointments,
              fieldDefs,
            });

            sessionsRemaining = ledger.remaining;
            sessionsCompleted = ledger.attended;
            seriesType = ledger.seriesType;
            sessionPrepaid = ledger.remaining > 0 || ledger.prepaidOverride;
          } catch (err) {
            console.error(`[staff-data] Contact enrich error for ${contactId}:`, err.message);
          }
        }

        return {
          id: event.id,
          contactId: contactId || "",
          contactName,
          startTime: event.startTime || event.start_time,
          endTime: event.endTime || event.end_time,
          title: event.title || event.calendarName || "Session",
          calendarName: event.calendarName || "",
          sessionsRemaining,
          sessionsCompleted,
          seriesType,
          tags,
          sessionPrepaid,
        };
      })
    );

    return new Response(JSON.stringify(enriched), { status: 200, headers });
  } catch (err) {
    console.error("[staff-data] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
