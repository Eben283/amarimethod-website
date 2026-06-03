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

// Two distinct predicates per the 2026-05-29 session-fields contract
// (see SESSION-FIELDS-AUDIT.md):
//
//   sessions_completed = lifetime journey ("how much real bodywork has the
//     client done with the Amari Method?")
//     Excludes pre-session phone chats only — discovery, consultation,
//     15-min, pain assessment (intake quiz).
//     Includes entrainments AND partner-initials — both are real bodywork,
//     just billed differently (entrainment = $90 separate, partner-init = comp).
//
//   sessions_remaining = prepaid package balance ("when do I need to act?")
//     Excludes everything above PLUS entrainments (billed separately) AND
//     partner-initials (comp perk) — neither draws from a prepaid package.
const NON_JOURNEY_PATTERNS = /pain assessment|discovery call|15-minute|15 minute|consultation/i;
const NON_PACKAGE_PATTERNS = /pain assessment|discovery call|15-minute|15 minute|consultation|partner|entrainment/i;
// Back-compat alias — older code refs may exist; keep the name pointing at
// the package predicate (the historical meaning).
const NON_SESSION_PATTERNS = NON_PACKAGE_PATTERNS;

// Garrett's protocol pairs a follow-up with an immediately-adjacent entrainment.
// When a follow-up is marked showed, the entrainment within ±90 min is auto-flipped.
const ENTRAINMENT_CALENDAR_ID = "B5aGXLoS4kzAjZAMMXxk";
const FOLLOWUP_CALENDAR_IDS = new Set([
  "ZO1jlGfy01rsxVqicoSB", // Follow-up Session — In Person (Package)
  "SKDVOL8wtUN6Ne0ppbC9", // Follow-up Session — In Person
  "oVn77FcecFY16iS2pHyP", // Follow-up Session — Virtual
  "bJFkhVP35Ecwh4tLnSmy", // Follow-up Session — Virtual (Package)
]);
const PAIR_WINDOW_MS = 90 * 60 * 1000;

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
      // 404 when the underlying GHL fetch returned 404 (contact doesn't
      // exist or was deleted) — matches the convention in
      // ghl-purchase-webhook.js + ghl-invoice-webhook.js. 422 for other
      // upstream failures (rate limit, server error, etc.).
      const status = contactRes.status === 404 ? 404 : 422;
      return new Response(JSON.stringify({ error: "Failed to load contact" }), { status, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // Check current appointment status — if already showed/completed, skip (idempotent)
    let currentApptStatus = null;
    let allAppts = [];
    let thisAppt = null;
    if (apptListRes.ok) {
      const apptListData = await apptListRes.json();
      allAppts = apptListData.appointments || apptListData.events || [];
      thisAppt = allAppts.find((a) => a.id === appointmentId);
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

    // Pair-mark: when a follow-up is marked showed, auto-flip a paired entrainment
    // appointment within ±90 min. The pair-mark flips the appointment status only —
    // it does NOT trigger a separate sessions_completed/sessions_remaining update
    // for the entrainment (no second POST). The entrainment will count toward
    // lifetime sessions_completed if/when its own "mark attended" runs (or via
    // the series-reconcile-worker continuous sync).
    // sessions_remaining is never decremented for entrainments — they're billed
    // separately at $90 and don't draw from the prepaid package per the
    // NON_PACKAGE_PATTERNS predicate.
    let pairedEntrainmentId = null;
    if (thisAppt && thisAppt.calendarId && FOLLOWUP_CALENDAR_IDS.has(thisAppt.calendarId)) {
      const thisStartRaw = thisAppt.startTime || thisAppt.start_time;
      const thisStartMs = thisStartRaw ? new Date(thisStartRaw).getTime() : NaN;
      if (Number.isFinite(thisStartMs)) {
        const paired = allAppts.find((a) => {
          if (a.id === appointmentId) return false;
          if (a.calendarId !== ENTRAINMENT_CALENDAR_ID) return false;
          const status = (a.appointmentStatus || a.status || "").toLowerCase();
          if (status !== "confirmed") return false;
          const aStartRaw = a.startTime || a.start_time;
          const aStartMs = aStartRaw ? new Date(aStartRaw).getTime() : NaN;
          return Number.isFinite(aStartMs) && Math.abs(aStartMs - thisStartMs) <= PAIR_WINDOW_MS;
        });
        if (paired) {
          try {
            const pairRes = await ghlFetch(context, `${GHL_API_BASE}/calendars/events/appointments/${paired.id}`, {
              method: "PUT",
              body: JSON.stringify({ appointmentStatus: "showed" }),
            });
            if (pairRes.ok) {
              pairedEntrainmentId = paired.id;
            } else {
              const errText = await pairRes.text();
              console.error(`[staff-mark-attended] Paired entrainment update failed: ${pairRes.status} ${errText}`);
            }
          } catch (err) {
            console.error("[staff-mark-attended] Paired entrainment update error:", err);
          }
        }
      }
    }

    // Apply the two predicates per session-fields contract (see
    // SESSION-FIELDS-AUDIT.md). countsTowardLifetime can be true while
    // drawsFromPackage is false — that's exactly the entrainment case.
    const appointmentTitle = body.appointmentTitle || "";
    const calendarName = body.calendarName || "";
    const titleAndCal = `${appointmentTitle} ${calendarName}`;
    const countsTowardLifetime = !NON_JOURNEY_PATTERNS.test(titleAndCal);
    const drawsFromPackage = !NON_PACKAGE_PATTERNS.test(titleAndCal);
    // Back-compat: existing API contract returns `isSession`. Keep it tied to
    // the package predicate (the historical meaning of "this is a paid
    // session that counts against the prepaid balance").
    const isSession = drawsFromPackage;

    let newCompleted = currentCompleted;
    let newRemaining = currentRemaining;

    if (countsTowardLifetime || drawsFromPackage) {
      if (countsTowardLifetime) newCompleted = currentCompleted + 1;
      if (drawsFromPackage) newRemaining = currentRemaining > 0 ? currentRemaining - 1 : 0;

      // Build custom field updates — write whichever fields changed.
      const customFields = [];
      if (countsTowardLifetime) {
        customFields.push({ id: FIELD_IDS.sessions_completed, field_value: String(newCompleted) });
      }
      if (drawsFromPackage) {
        customFields.push({ id: FIELD_IDS.sessions_remaining, field_value: String(newRemaining) });
      }

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
      pairedEntrainmentId,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-mark-attended] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
