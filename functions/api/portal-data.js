// Cloudflare Pages Function: GET /api/portal-data
// Returns client data from GHL: contact details, appointments, series progress

const GHL_API_BASE = "https://services.leadconnectorhq.com";

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
function getCustomField(contact, fieldKey) {
  if (!contact.customFields) return null;
  const field = contact.customFields.find(
    (f) => f.id === fieldKey || f.key === fieldKey
  );
  return field ? field.value || field.field_value : null;
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

    // Fetch contact details and appointments in parallel
    const [contactResponse, appointmentsResponse] = await Promise.all([
      fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetch(`${GHL_API_BASE}/contacts/${contactId}/appointments`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
    ]);

    if (!contactResponse.ok) {
      console.error(`[portal-data] GHL contact fetch error: ${contactResponse.status}`);
      return new Response(
        JSON.stringify({ error: "Unable to load your data. Please try again." }),
        { status: 502, headers }
      );
    }

    const contactData = await contactResponse.json();
    const contact = contactData.contact;

    // Parse appointments (may fail if contact has none)
    let allAppointments = [];
    if (appointmentsResponse.ok) {
      const apptData = await appointmentsResponse.json();
      allAppointments = apptData.appointments || apptData.events || [];
      // DEBUG: Log raw appointment to discover all fields (remove after confirming)
      if (allAppointments.length > 0) {
        console.log("[portal-data] Raw appointment keys:", Object.keys(allAppointments[0]));
        console.log("[portal-data] Raw appointment[0]:", JSON.stringify(allAppointments[0]));
      }
    }

    // Parse custom fields for series tracking
    const seriesType = getCustomField(contact, "series_type") || "none";
    const sessionsCompleted = parseInt(getCustomField(contact, "sessions_completed") || "0", 10);
    const sessionsRemaining = parseInt(getCustomField(contact, "sessions_remaining") || "0", 10);
    const lpField = (getCustomField(contact, "living_practice_access") || "").toString().toLowerCase();
    const hasLivingPractice = ["true", "yes", "1"].includes(lpField) ||
      (contact.tags || []).includes("living-practice-access");
    const paField = (getCustomField(contact, "portal_access") || "").toString().toLowerCase();
    const portalAccess = ["true", "yes", "1"].includes(paField) ||
      (contact.tags || []).includes("portal-access");

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

    return new Response(
      JSON.stringify({
        client: {
          contactId: contact.id,
          firstName: contact.firstName || "there",
          lastName: contact.lastName || "",
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
