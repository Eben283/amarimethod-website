// Cloudflare Pages Function: GET /api/portal-data
// Returns client data from GHL: contact details, appointments, series progress

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

function ghlHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Version": "2021-07-28",
  };
}

// Verify session token
async function verifySessionToken(tokenString, secret) {
  const parts = tokenString.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(data));
  if (!valid) throw new Error("Invalid signature");

  const payload = JSON.parse(atob(body));

  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}

// Extract custom field value from GHL contact
// fieldDefs is a map of { [key: string]: string } — field key (short) → field ID
function getCustomField(contact, fieldKey, fieldDefs = {}) {
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
    const GHL_API_KEY = context.env.GHL_API_KEY;

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

    // Fetch contact details, appointments, and custom field definitions in parallel
    const [contactResponse, appointmentsResponse, fieldDefsResponse] = await Promise.all([
      fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetch(`${GHL_API_BASE}/contacts/${contactId}/appointments`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetch(`${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
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

    // Parse custom fields for series tracking
    const seriesType = getCustomField(contact, "series_type", fieldDefs) || "none";
    const fieldSessionsCompleted = parseInt(getCustomField(contact, "sessions_completed", fieldDefs) ?? "0", 10);
    const sessionsRemaining = parseInt(getCustomField(contact, "sessions_remaining", fieldDefs) ?? "0", 10);

    // Count actual completed appointments as a fallback for sessions_completed
    const completedAppointmentCount = allAppointments.filter(
      (a) => (a.appointmentStatus || a.status || "").toLowerCase() === "completed"
    ).length;
    const sessionsCompleted = Math.max(fieldSessionsCompleted, completedAppointmentCount);
    const lpRaw = getCustomField(contact, "living_practice_access", fieldDefs);
    const lpField = (lpRaw ?? "").toString().toLowerCase();
    const hasLivingPractice = !!lpRaw || ["true", "yes", "1"].includes(lpField) ||
      (contact.tags || []).includes("living-practice-access");
    const paRaw = getCustomField(contact, "portal_access", fieldDefs);
    const paField = (paRaw ?? "").toString().toLowerCase();
    const portalAccess = !!paRaw || ["true", "yes", "1"].includes(paField) ||
      (contact.tags || []).includes("portal-access");
    console.log("[portal-data] lp raw:", JSON.stringify(lpRaw), "pa raw:", JSON.stringify(paRaw), "fieldDefs keys:", Object.keys(fieldDefs).join(","));

    // Sort appointments by date
    const now = new Date().toISOString();
    const sortedAppointments = allAppointments
      .map((appt) => ({
        id: appt.id,
        title: appt.title || appt.calendarName || "Session",
        startTime: appt.startTime || appt.start_time,
        endTime: appt.endTime || appt.end_time,
        status: (appt.appointmentStatus || appt.status || "confirmed").toLowerCase(),
        appointmentType: appt.calendarName || appt.title || "Session",
      }))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    // Split into past and upcoming
    const pastAppointments = sortedAppointments.filter((a) => a.startTime < now);
    const upcomingAppointments = sortedAppointments
      .filter((a) => a.startTime >= now && a.status !== "cancelled")
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
          hasLivingPractice,
          portalAccess,
        },
        appointments: pastAppointments,
        upcomingAppointments,
        _debug: {
          lpRaw,
          paRaw,
          fieldDefs,
          rawCustomFields: contact.customFields || [],
        },
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
