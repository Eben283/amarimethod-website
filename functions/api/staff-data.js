// Cloudflare Pages Function: GET /api/staff-data
// Returns today's appointments with enriched contact data

import { ghlHeaders, getGhlToken, ghlFetch } from "../lib/ghl.js";
import { getCustomField } from "../lib/portal-helpers.js";
import { deriveLedger, hydrateOrders } from "../lib/session-ledger.js";
import { readPaymentRecord } from "../lib/session-payment.js";
import { countsTowardLifetime } from "../lib/journey-classification.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import { parsePacificWallClock } from "../lib/datetime.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
// All current Amari booking calendars are assigned to Garrett. Querying the
// practitioner once returns the operational schedule across those calendars;
// the calendar list below remains the allowlist and source for display names.
const GHL_GARRETT_USER_ID = "P5b0oSTaVYfULDjZ6YyG";


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


    const GHL_API_KEY = await getGhlToken(context);

    // Support ?date=YYYY-MM-DD and ?endDate=YYYY-MM-DD for ranges
    const url = new URL(context.request.url);
    const dateParam = url.searchParams.get('date');
    const endDateParam = url.searchParams.get('endDate');
    // MoneyMoments needs today's CANCELLED sessions (to surface a reschedule+pitch
    // recovery moment). The main Today schedule omits this param → cancelled stay hidden.
    const includeCancelled = url.searchParams.get('includeCancelled') === '1';
    // Week/home calendar surfaces only render appointment identity and time.
    // They must not wait for the full contact ledger fan-out (contact,
    // lifetime appointments, orders, invoices, order hydration, and payment
    // records) that the detailed day cards require.
    const summaryOnly = url.searchParams.get('summary') === '1';
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

    // Fetch the calendar definitions once for the Staff display-name mapping
    // and to retain the existing location-calendar allowlist.
    const calendarsRes = await ghlFetch(context, `${GHL_API_BASE}/calendars/?locationId=${GHL_LOCATION_ID}`);
    if (!calendarsRes.ok) {
      console.error(`[staff-data] Calendars list error: ${calendarsRes.status}`);
      return new Response(JSON.stringify({ error: "Failed to load calendars" }), { status: 422, headers });
    }
    const calendarsData = await calendarsRes.json();
    const allCalendars = calendarsData.calendars || [];

    const calendarNames = new Map(allCalendars.map((calendar) => [calendar.id, calendar.name]));
    const eventParams = new URLSearchParams({
      locationId: GHL_LOCATION_ID,
      userId: GHL_GARRETT_USER_ID,
      startTime: String(startTime),
      endTime: String(endTime),
    });
    const eventsRes = await ghlFetch(context, `${GHL_API_BASE}/calendars/events?${eventParams}`);
    if (!eventsRes.ok) {
      console.error(`[staff-data] Practitioner schedule error: ${eventsRes.status}`);
      return new Response(JSON.stringify({ error: "Failed to load calendar appointments" }), { status: 422, headers });
    }
    const eventsData = await eventsRes.json();
    const eventMap = new Map();
    for (const event of eventsData.events || []) {
      const calendarId = event.calendarId || event.calendar_id;
      // Keep the same scope as the former one-request-per-location-calendar
      // implementation; unknown provider calendars cannot leak into Staff.
      if (!calendarId || !calendarNames.has(calendarId) || eventMap.has(event.id)) continue;
      eventMap.set(event.id, { ...event, calendarName: calendarNames.get(calendarId) || "" });
    }
    const events = Array.from(eventMap.values());

    // Filter to non-cancelled appointments (unless includeCancelled — MoneyMoments).
    const todayEvents = includeCancelled ? events : events.filter(
      (e) => (e.appointmentStatus || e.status || "").toLowerCase() !== "cancelled"
    );

    // Sort chronologically
    todayEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    if (summaryOnly) {
      const summaries = todayEvents.map((event) => ({
        id: event.id,
        calendarId: event.calendarId || event.calendar_id || "",
        contactId: event.contactId || "",
        contactName: event.title || "Unknown",
        startTime: event.startTime || event.start_time,
        endTime: event.endTime || event.end_time,
        title: event.title || event.calendarName || "Session",
        calendarName: event.calendarName || "",
        appointmentStatus: (event.appointmentStatus || event.status || "").toLowerCase(),
        meetingLocation: event.meetingLocation || null,
        sessionsRemaining: 0,
        sessionsCompleted: 0,
        seriesType: "none",
        tags: [],
        sessionPrepaid: false,
        paymentStatus: "unknown",
        paymentMethod: null,
        paymentNote: null,
      }));
      return new Response(JSON.stringify(summaries), { status: 200, headers });
    }

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
    // Chunked enrichment — each event fans out 4-5 GHL calls + order
    // hydration. An unbounded Promise.all over a busy week view was the exact
    // connection-cap incident class staff-balances fixed on 2026-06-03; when
    // it blew up, every contact's catch returned zeros and paid clients
    // rendered "Unpaid" with no error indication.
    const ENRICH_CHUNK = 3;
    const enrichOne = async (event) => {
        const contactId = event.contactId;
        let contactName = event.title || "Unknown";
        let sessionsRemaining = 0;
        let sessionsCompleted = 0;
        let seriesType = "none";
        let tags = [];
        let sessionPrepaid = false;
        let paymentStatus = "unknown";
        let paymentMethod = null;
        let paymentNote = null;
        let enrichmentFailed = false;

        if (contactId) {
          try {
            const capitalize = (s) => s ? s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : "";
            const [contactRes, apptRes, ordersRes, invoicesRes] = await Promise.all([
              ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
              ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
              ghlFetch(context, `${GHL_API_BASE}/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=50`),
              // offset=0 required or GHL invoices endpoint returns 422
              ghlFetch(context, `${GHL_API_BASE}/invoices/?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`),
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

            const ledgerFetchFailures = [];
            if (!contactRes.ok) ledgerFetchFailures.push(`contact (${contactRes.status})`);
            if (!ordersRes.ok) ledgerFetchFailures.push(`orders (${ordersRes.status})`);
            if (!invoicesRes.ok) ledgerFetchFailures.push(`invoices (${invoicesRes.status})`);
            if (!apptRes.ok) ledgerFetchFailures.push(`appointments (${apptRes.status})`);
            const ordersList = ordersRes.ok ? ((await ordersRes.json()).data || []) : [];
            // POS orders need /payments/orders/{id} hydration — see
            // session-ledger.js → hydrateOrders. Without it POS package
            // purchases derive as 0 sessions.
            const orders = await hydrateOrders(context, ordersList);
            const invoices = invoicesRes.ok ? ((await invoicesRes.json()).invoices || []) : [];
            let appointments = [];
            if (apptRes.ok) {
              const apptData = await apptRes.json();
              appointments = apptData.appointments || apptData.events || [];
            }

            const ledger = deriveLedger({
              contact: contact || { customFields: [] },
              orders,
              invoices,
              appointments,
              fieldDefs,
              fetchFailures: ledgerFetchFailures,
            });

            // Use display values from deriveLedger — falls back to field
            // when locked or low confidence. See session-ledger.js display block.
            sessionsRemaining = ledger.display.remaining;
            // sessionsCompleted = LIFETIME journey count per 2026-05-29
            // session-fields contract (was: ledger.attended which is
            // package-only). Matches portal-data.js semantic so the staff
            // app shows the same number the client sees.
            const nowMs = Date.now();
            sessionsCompleted = appointments.filter((a) => {
              const status = (a.appointmentStatus || a.status || "").toLowerCase();
              if (!["completed", "showed", "confirmed"].includes(status)) return false;
              // Naive-Pacific parse (2026-07-02 audit).
              const startMs = parsePacificWallClock(a.startTime || a.start_time || "");
              if (!Number.isFinite(startMs) || startMs >= nowMs) return false;
              const title = (a.title || "") + " " + (a.calendarName || "");
              return countsTowardLifetime(title);
            }).length;
            seriesType = ledger.display.seriesType;
            sessionPrepaid = sessionsRemaining > 0 || ledger.prepaidOverride;

            // Per-session payment status for THIS appointment (event.id), keyed
            // in PURCHASE_KV. Fail-soft → stays "unknown". See session-payment.js.
            const payRec = await readPaymentRecord(context.env.PURCHASE_KV, contactId, event.id);
            if (payRec) {
              paymentStatus = payRec.status;
              paymentMethod = payRec.method;
              paymentNote = payRec.note;
            }
          } catch (err) {
            // Surfaced to the row (enrichmentFailed) — silent zeros here made
            // paid clients read as "Unpaid" whenever enrichment blew up.
            console.error(`[staff-data] Contact enrich error for ${contactId}:`, err.message);
            enrichmentFailed = true;
          }
        }

        return {
          id: event.id,
          calendarId: event.calendarId || event.calendar_id || "",
          contactId: contactId || "",
          contactName,
          startTime: event.startTime || event.start_time,
          endTime: event.endTime || event.end_time,
          title: event.title || event.calendarName || "Session",
          calendarName: event.calendarName || "",
          appointmentStatus: (event.appointmentStatus || event.status || "").toLowerCase(),
          meetingLocation: event.meetingLocation || null,
          sessionsRemaining,
          sessionsCompleted,
          seriesType,
          tags,
          sessionPrepaid,
          paymentStatus,
          paymentMethod,
          paymentNote,
          enrichmentFailed,
        };
      };

    const enriched = [];
    for (let i = 0; i < todayEvents.length; i += ENRICH_CHUNK) {
      const part = await Promise.all(todayEvents.slice(i, i + ENRICH_CHUNK).map(enrichOne));
      enriched.push(...part);
    }

    return new Response(JSON.stringify(enriched), { status: 200, headers });
  } catch (err) {
    console.error("[staff-data] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
