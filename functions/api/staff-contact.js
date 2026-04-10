// Cloudflare Pages Function: GET /api/staff-contact?id=
// Full contact detail: info, appointments, notes, messages

import { ghlFetch } from "../lib/ghl.js";
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
    const contactId = url.searchParams.get("id");
    if (!contactId) {
      return new Response(JSON.stringify({ error: "Contact ID required" }), { status: 400, headers });
    }

    // Fetch contact, appointments, notes, conversations, orders, calendars, and field defs in parallel
    const [contactRes, appointmentsRes, notesRes, conversationsRes, ordersRes, calendarsRes, fieldDefsRes] = await Promise.all([
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/notes`),
      ghlFetch(context, `${GHL_API_BASE}/conversations/search?contactId=${contactId}&locationId=${GHL_LOCATION_ID}`),
      ghlFetch(context, `${GHL_API_BASE}/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=50`),
      ghlFetch(context, `${GHL_API_BASE}/calendars/?locationId=${GHL_LOCATION_ID}`),
      ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`),
    ]);

    if (!contactRes.ok) {
      console.error(`[staff-contact] Contact fetch error: ${contactRes.status}`);
      return new Response(JSON.stringify({ error: "Failed to load contact" }), { status: 422, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // Build calendar name map
    const calendarMap = {};
    if (calendarsRes.ok) {
      const calData = await calendarsRes.json();
      for (const cal of (calData.calendars || [])) {
        calendarMap[cal.id] = cal.name;
      }
    }

    // Build field defs map
    let fieldDefs = {};
    if (fieldDefsRes.ok) {
      const fieldDefsData = await fieldDefsRes.json();
      for (const f of (fieldDefsData.customFields || [])) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    // Parse appointments — keep raw GHL fields for the ledger, build display shape separately
    let rawAppointments = [];
    let appointments = [];
    if (appointmentsRes.ok) {
      const apptData = await appointmentsRes.json();
      rawAppointments = apptData.appointments || apptData.events || [];
      appointments = rawAppointments
        .map((a) => ({
          id: a.id,
          title: a.title || a.calendarName || "Session",
          calendarName: calendarMap[a.calendarId] || a.calendarName || "",
          startTime: a.startTime || a.start_time,
          endTime: a.endTime || a.end_time,
          status: (a.appointmentStatus || a.status || "confirmed").toLowerCase(),
        }))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }

    // Last completed appointment (any type, including entrainments — for "last visit" display)
    const completedAppointments = appointments.filter(
      (a) => a.status === "completed" || a.status === "showed"
    );
    const lastCompleted = completedAppointments[0]; // sorted newest-first

    // Parse notes
    let notes = [];
    if (notesRes.ok) {
      const notesData = await notesRes.json();
      notes = (notesData.notes || []).map((n) => ({
        id: n.id,
        body: n.body || "",
        dateAdded: n.dateAdded || n.createdAt || "",
      }));
    }

    // Parse messages — fetch from ALL conversations and merge, sorted newest-first.
    // A client can have multiple conversations (SMS + Email + etc.), and GHL doesn't
    // guarantee ordering, so we can't just pick conversations[0].
    let messages = [];
    if (conversationsRes.ok) {
      const convoData = await conversationsRes.json();
      const conversations = convoData.conversations || [];
      try {
        const allMessageBatches = await Promise.all(
          conversations.map(async (conv) => {
            const msgRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/${conv.id}/messages`);
            if (!msgRes.ok) return [];
            const msgData = await msgRes.json();
            // GHL double-nests: msgData.messages?.messages
            return msgData.messages?.messages || msgData.messages || [];
          }),
        );
        const merged = allMessageBatches.flat();
        messages = merged
          .map((m) => ({
            id: m.id,
            body: m.body || m.message || "",
            direction: m.direction === 1 || m.direction === "inbound" ? "inbound" : "outbound",
            dateAdded: m.dateAdded || m.createdAt || "",
            type: (m.type || "SMS").toUpperCase().includes("EMAIL") ? "Email" : "SMS",
          }))
          .sort((a, b) => {
            const ta = new Date(a.dateAdded).getTime() || 0;
            const tb = new Date(b.dateAdded).getTime() || 0;
            return tb - ta;
          })
          .slice(0, 20);
      } catch (err) {
        console.error(`[staff-contact] Messages fetch error:`, err.message);
      }
    }

    // Source-of-truth ledger from orders + appointments (excludes entrainments,
    // discovery calls, and partner sessions from series counts).
    let orders = [];
    if (ordersRes.ok) {
      const ordersData = await ordersRes.json();
      orders = ordersData.data || [];
    }
    const ledger = deriveLedger({
      contact,
      orders,
      appointments: rawAppointments,
      fieldDefs,
    });
    const seriesType = ledger.seriesType;
    const sessionsRemaining = ledger.remaining;
    const sessionPrepaid = ledger.remaining > 0 || ledger.prepaidOverride;

    // Parse quiz results from custom fields (set by /api/send-to-ghl)
    const quizPattern = getCustomField(contact, "BvTGZ9O9ayecw5f0Nj76", fieldDefs);
    const quizResults = quizPattern ? {
      patternSignature: quizPattern,
      recoveryPotentialScore: getCustomField(contact, "PhQQjTF1fiLgtnAgKZZP", fieldDefs),
      primaryPainLocation: getCustomField(contact, "vKZTVAG7601lgV8413du", fieldDefs),
      painDuration: getCustomField(contact, "wrYzlW0ta2SGD8cI5iTM", fieldDefs),
      painIntensity: getCustomField(contact, "iCMhoomSzLnCUCcludwD", fieldDefs),
      painTrigger: getCustomField(contact, "NaNk1OVQLu8CcONUnyNz", fieldDefs),
      additionalPainAreas: getCustomField(contact, "NCDnl1jHDvDATpRKhkeV", fieldDefs),
      painType: getCustomField(contact, "tIIxUQT8hrkpDYY3WhWn", fieldDefs),
      treatmentsTried: getCustomField(contact, "y5HBXMycSnfFPSOcnR2y", fieldDefs),
      treatmentResults: getCustomField(contact, "1MSGnUASa5Zd9lKoNdvO", fieldDefs),
      aggravatingActivities: getCustomField(contact, "IqxEaCTcZpvGuDUC3O9c", fieldDefs),
      dailyImpact: getCustomField(contact, "zin4frkDKBWvVoN7ztZW", fieldDefs),
    } : null;

    const capitalize = (s) => s ? s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : "";

    // Sessions completed = derived from appointment history (excludes entrainments etc.)
    const derivedSessionsCompleted = ledger.attended;

    // Client progress — from custom fields in "Session Progress" folder
    const MODULE_KEYS = [
      "suspension_squat", "hand_balancer", "power_posture", "vertical_drop",
      "active_bridge", "passive_bridge", "spinal_wave", "spring_step",
      "elbow_reset", "jaw_align",
    ];
    const clientProgress = {
      modules: {},
      yogaBlockSize: null,
      bodyGraph: {},
    };
    for (const key of MODULE_KEYS) {
      const val = getCustomField(contact, key, fieldDefs);
      const moduleId = key.replace(/_/g, "-");
      if (val && (val === "Taught" || (Array.isArray(val) && val.includes("Taught")))) {
        clientProgress.modules[moduleId] = true;
      }
    }
    for (const region of ["upper", "middle", "lower"]) {
      const val = getCustomField(contact, `${region}_body`, fieldDefs);
      if (val === "Active" || val === "Passive") {
        clientProgress.bodyGraph[region] = val.toLowerCase();
      }
    }
    const blockVal = getCustomField(contact, "yoga_block_size", fieldDefs);
    if (blockVal === '3"' || blockVal === '4"') {
      clientProgress.yogaBlockSize = blockVal.charAt(0);
    }

    const result = {
      id: contact.id,
      firstName: capitalize(contact.firstName) || "",
      lastName: capitalize(contact.lastName) || "",
      email: contact.email || "",
      phone: contact.phone || "",
      seriesType,
      sessionsCompleted: derivedSessionsCompleted,
      sessionsRemaining,
      sessionPrepaid,
      tags: contact.tags || [],
      dateAdded: contact.dateAdded || "",
      lastAppointment: lastCompleted ? lastCompleted.startTime : null,
      appointments,
      notes,
      messages,
      quizResults,
      clientProgress,
    };

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err) {
    console.error("[staff-contact] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
