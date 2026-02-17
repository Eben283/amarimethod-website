// Cloudflare Pages Function: POST /api/send-to-ghl
// Receives quiz results from frontend and upserts contact in GHL

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs (created via GHL API)
const FIELD_IDS = {
  painPatternSignature: "BvTGZ9O9ayecw5f0Nj76",
  recoveryPotentialScore: "PhQQjTF1fiLgtnAgKZZP",
  primaryPainLocation: "vKZTVAG7601lgV8413du",
};

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const body = await context.request.json();

    // Validate required fields
    const { firstName, lastName, email } = body;
    if (!firstName || !lastName || !email) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: firstName, lastName, email" }),
        { status: 400, headers }
      );
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers }
      );
    }

    // Build tags array
    const tags = ["quiz submitted"];
    const severity = body.painSeverity;
    if (severity === "mild") tags.push("pain-severity-mild");
    else if (severity === "severe") tags.push("pain-severity-severe");
    else tags.push("pain-severity-moderate");

    // Build custom fields array
    const customFields = [
      { id: FIELD_IDS.painPatternSignature, field_value: String(body.patternSignature || "Unknown") },
      { id: FIELD_IDS.recoveryPotentialScore, field_value: Number(body.recoveryPotentialScore) || 0 },
      { id: FIELD_IDS.primaryPainLocation, field_value: String(body.primaryPainLocation || "Unknown") },
    ];

    // Upsert contact in GHL
    const ghlPayload = {
      firstName: String(firstName).slice(0, 100),
      lastName: String(lastName).slice(0, 100),
      email: String(email).slice(0, 200),
      phone: body.phone ? String(body.phone).slice(0, 20) : undefined,
      locationId: GHL_LOCATION_ID,
      tags,
      customFields,
      source: "Pain Assessment Quiz",
    };

    const GHL_API_KEY = context.env.GHL_API_KEY;
    if (!GHL_API_KEY) {
      console.error("[send-to-ghl] GHL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    const ghlResponse = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GHL_API_KEY}`,
        "Content-Type": "application/json",
        "Version": "2021-07-28",
      },
      body: JSON.stringify(ghlPayload),
    });

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      console.error(`[send-to-ghl] GHL API error: ${ghlResponse.status} ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to save contact" }),
        { status: 502, headers }
      );
    }

    const ghlData = await ghlResponse.json();
    console.log(`[send-to-ghl] Contact upserted: ${ghlData.contact?.id || "unknown"}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[send-to-ghl] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
