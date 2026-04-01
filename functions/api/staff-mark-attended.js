// Cloudflare Pages Function: POST /api/staff-mark-attended
// Marks an appointment as "showed" and updates session counts in GHL

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "./portal-data.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs (from TECHNICAL-REFERENCE.txt)
const FIELD_IDS = {
  sessions_completed: "TE0udwVH1Km5RsKaN5H0",
  sessions_remaining: "wrQSkx6BhXwDGIn1d0V4",
  session_prepaid: "sgQ5EbJWhvTfGVhStaOO",
};

// Appointment types that are NOT paid sessions — skip session counting
const NON_SESSION_PATTERNS = /pain assessment|discovery call|15-minute|15 minute|consultation|partner/i;

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    // Auth check
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

    // Parse request
    const body = await context.request.json();
    const appointmentId = (body.appointmentId || "").trim();
    const contactId = (body.contactId || "").trim();

    if (!appointmentId) {
      return new Response(JSON.stringify({ error: "Appointment ID required" }), { status: 400, headers });
    }
    if (!contactId) {
      return new Response(JSON.stringify({ error: "Contact ID required" }), { status: 400, headers });
    }

    // Fetch contact, appointment details, and field definitions in parallel
    const [contactRes, apptListRes, fieldDefsRes] = await Promise.all([
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
      ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`),
    ]);

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      console.error(`[staff-mark-attended] Contact fetch error: ${contactRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to load contact" }), { status: 422, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // Check current appointment status — if already showed/completed, skip (idempotent)
    let currentApptStatus = null;
    if (apptListRes.ok) {
      const apptListData = await apptListRes.json();
      const allAppts = apptListData.appointments || apptListData.events || [];
      const thisAppt = allAppts.find((a) => a.id === appointmentId);
      if (thisAppt) {
        currentApptStatus = (thisAppt.appointmentStatus || thisAppt.status || "").toLowerCase();
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

    // Get current session counts
    const currentCompleted = parseInt(getCustomField(contact, "sessions_completed", fieldDefs) ?? "0", 10);
    const currentRemaining = parseInt(getCustomField(contact, "sessions_remaining", fieldDefs) ?? "0", 10);

    // IDEMPOTENCY: If appointment is already "showed" or "completed", return current state without changing anything.
    // This prevents double-counting if both the dashboard button and the SMS trigger link are used.
    if (currentApptStatus === "showed" || currentApptStatus === "completed") {
      return new Response(JSON.stringify({
        success: true,
        alreadyAttended: true,
        appointmentUpdated: false,
        sessionCountUpdated: false,
        isSession: true,
        sessionsCompleted: currentCompleted,
        sessionsRemaining: currentRemaining,
      }), { status: 200, headers });
    }

    // Update appointment status to "showed"
    const apptRes = await ghlFetch(context, `${GHL_API_BASE}/calendars/events/appointments/${appointmentId}`, {
      method: "PUT",
      body: JSON.stringify({ appointmentStatus: "showed" }),
    });

    if (!apptRes.ok) {
      const errText = await apptRes.text();
      console.error(`[staff-mark-attended] Appointment update error: ${apptRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to update appointment" }), { status: 422, headers });
    }

    // Check if this is a paid session (not a discovery call / pain assessment)
    const appointmentTitle = body.appointmentTitle || "";
    const calendarName = body.calendarName || "";
    const isSession = !NON_SESSION_PATTERNS.test(appointmentTitle) && !NON_SESSION_PATTERNS.test(calendarName);

    let newCompleted = currentCompleted;
    let newRemaining = currentRemaining;

    if (isSession) {
      newCompleted = currentCompleted + 1;
      newRemaining = currentRemaining > 0 ? currentRemaining - 1 : 0;

      // Build custom field updates — always update session counts
      const customFields = [
        { id: FIELD_IDS.sessions_completed, field_value: String(newCompleted) },
        { id: FIELD_IDS.sessions_remaining, field_value: String(newRemaining) },
      ];

      // Clear the single-session prepaid flag if this was a non-series session
      if (newRemaining === 0) {
        customFields.push({ id: FIELD_IDS.session_prepaid, field_value: "no" });
      }

      const updateRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        body: JSON.stringify({ customFields }),
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        console.error(`[staff-mark-attended] Contact update error: ${updateRes.status} ${errText}`);
        return new Response(JSON.stringify({
          error: "Appointment marked as showed but session count update failed",
          appointmentUpdated: true,
          sessionCountUpdated: false,
          sessionsCompleted: currentCompleted,
          sessionsRemaining: currentRemaining,
        }), { status: 422, headers });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      alreadyAttended: false,
      appointmentUpdated: true,
      sessionCountUpdated: isSession,
      isSession,
      sessionsCompleted: newCompleted,
      sessionsRemaining: newRemaining,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-mark-attended] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
