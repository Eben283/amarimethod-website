// Cloudflare Pages Function: GET /api/staff-contact?id=
// Full contact detail: info, appointments, notes, messages

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

    // Parse appointments
    let appointments = [];
    if (appointmentsRes.ok) {
      const apptData = await appointmentsRes.json();
      const allAppts = apptData.appointments || apptData.events || [];
      appointments = allAppts
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

    // Exclude non-session appointments (discovery calls, pain assessments) from session count
    const NON_SESSION_PATTERNS = /pain assessment|discovery call|15-minute|15 minute|consultation|partner/i;
    const sessionAppointments = appointments.filter(
      (a) => !NON_SESSION_PATTERNS.test(a.title)
    );

    // Find last completed session + count completed sessions from history
    const completedSessions = sessionAppointments.filter(
      (a) => a.status === "completed" || a.status === "showed"
    );
    const completedAppointments = appointments.filter(
      (a) => a.status === "completed" || a.status === "showed"
    );
    const lastCompleted = completedAppointments[0]; // already sorted newest-first

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

    // Parse messages — get recent from the first conversation
    let messages = [];
    if (conversationsRes.ok) {
      const convoData = await conversationsRes.json();
      const conversations = convoData.conversations || [];
      if (conversations.length > 0) {
        const convoId = conversations[0].id;
        // Fetch messages for this conversation
        try {
          const msgRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/${convoId}/messages`);
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            // GHL double-nests: msgData.messages?.messages
            const rawMessages = msgData.messages?.messages || msgData.messages || [];
            messages = rawMessages
              .slice(0, 20)
              .map((m) => ({
                id: m.id,
                body: m.body || m.message || "",
                direction: m.direction === 1 || m.direction === "inbound" ? "inbound" : "outbound",
                dateAdded: m.dateAdded || m.createdAt || "",
                type: (m.type || "SMS").toUpperCase().includes("EMAIL") ? "Email" : "SMS",
              }));
          }
        } catch (err) {
          console.error(`[staff-contact] Messages fetch error:`, err.message);
        }
      }
    }

    // Parse custom fields
    const seriesType = getCustomField(contact, "series_type", fieldDefs) || "none";
    const sessionsCompleted = parseInt(getCustomField(contact, "sessions_completed", fieldDefs) ?? "0", 10);
    const sessionsRemaining = parseInt(getCustomField(contact, "sessions_remaining", fieldDefs) ?? "0", 10);

    // Derive prepaid status: series remaining, OR payment history > attended, OR manual override
    const sessionPrepaidOverride = (getCustomField(contact, "session_prepaid", fieldDefs) || "").toLowerCase() === "yes";
    let sessionPrepaid = sessionsRemaining > 0 || sessionPrepaidOverride;
    if (!sessionPrepaid && ordersRes.ok) {
      const ordersData = await ordersRes.json();
      const allOrders = ordersData.data || [];
      const SERIES_PATTERN = /series|upgrade/i;
      const individualPayments = allOrders.filter(
        (o) => o.status === "completed" && (o.amount || 0) > 0 && !SERIES_PATTERN.test(o.sourceName || "")
      ).length;
      if (individualPayments > completedSessions.length) {
        sessionPrepaid = true;
      }
    }

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

    // Use appointment history count if custom field is empty/zero
    const derivedSessionsCompleted = sessionsCompleted > 0
      ? sessionsCompleted
      : completedSessions.length;

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
