// TEMPORARY: Debug endpoint to inspect raw GHL appointment data
// DELETE THIS FILE after confirming field names

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
    const GHL_API_KEY = context.env.GHL_API_KEY;
    // Hardcode your contact ID for this debug call
    const contactId = "k3t5Uh05eBzIOGZtiAVR";

    const response = await fetch(
      `${GHL_API_BASE}/contacts/${contactId}/appointments`,
      { headers: ghlHeaders(GHL_API_KEY) }
    );

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `GHL returned ${response.status}` }),
        { status: 502, headers }
      );
    }

    const data = await response.json();
    const appointments = data.appointments || data.events || [];

    return new Response(
      JSON.stringify({
        totalAppointments: appointments.length,
        firstAppointmentKeys: appointments.length > 0 ? Object.keys(appointments[0]) : [],
        firstAppointmentRaw: appointments.length > 0 ? appointments[0] : null,
      }, null, 2),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers }
    );
  }
}
