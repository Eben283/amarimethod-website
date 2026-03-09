// Cloudflare Pages Function: POST /api/portal-cancel
// Cancels an upcoming appointment via GHL API

const GHL_API_BASE = "https://services.leadconnectorhq.com";

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

function ghlHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Version": "2021-07-28",
  };
}

// Verify session token (same as portal-data.js)
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

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    const GHL_API_KEY = context.env.GHL_API_KEY;

    if (!JWT_SECRET || !GHL_API_KEY) {
      console.error("[portal-cancel] Missing env vars");
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

    // Parse request body
    const body = await context.request.json();
    const { appointmentId, title } = body;

    if (!appointmentId) {
      return new Response(
        JSON.stringify({ error: "Missing appointmentId" }),
        { status: 400, headers }
      );
    }

    console.log(`[portal-cancel] User ${tokenPayload.contactId} cancelling appointment ${appointmentId}`);

    // Verify the appointment belongs to this contact before cancelling.
    // Soft-fail: if the GHL call itself errors, allow through rather than blocking
    // a legitimate cancellation due to a transient API issue.
    try {
      const ownershipResponse = await fetch(
        `${GHL_API_BASE}/contacts/${tokenPayload.contactId}/appointments`,
        { headers: ghlHeaders(GHL_API_KEY) }
      );
      if (ownershipResponse.ok) {
        const ownershipData = await ownershipResponse.json();
        const contactAppointments = ownershipData.appointments || ownershipData.events || [];
        const ownsAppointment = contactAppointments.some((a) => a.id === appointmentId);
        if (!ownsAppointment) {
          console.warn(
            `[portal-cancel] Contact ${tokenPayload.contactId} attempted to cancel appointment ${appointmentId} — not found on their contact`
          );
          return new Response(
            JSON.stringify({ error: "Appointment not found." }),
            { status: 404, headers }
          );
        }
      } else {
        console.warn(`[portal-cancel] Ownership check GHL error ${ownershipResponse.status} — allowing through`);
      }
    } catch (ownershipErr) {
      console.warn(`[portal-cancel] Ownership check error: ${ownershipErr.message} — allowing through`);
    }

    // Cancel the appointment via GHL API
    // PUT requires title to be present alongside the status update
    const cancelResponse = await fetch(
      `${GHL_API_BASE}/calendars/events/appointments/${appointmentId}`,
      {
        method: "PUT",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({
          title: title || "Session",
          appointmentStatus: "cancelled",
        }),
      }
    );

    if (!cancelResponse.ok) {
      const errorText = await cancelResponse.text();
      console.error(`[portal-cancel] GHL cancel error: ${cancelResponse.status} ${errorText}`);
      return new Response(
        JSON.stringify({ error: `Unable to cancel appointment (GHL ${cancelResponse.status}). Please try again or contact us.` }),
        { status: 422, headers }
      );
    }

    console.log(`[portal-cancel] Successfully cancelled appointment ${appointmentId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[portal-cancel] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
