// Cloudflare Pages Function: POST /api/affiliate-refer
// Receives affiliate referral form data, creates/upserts contact in GHL,
// tags with affiliate-referral, and adds a note with affiliate details.

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const body = await context.request.json();

    // Validate required fields
    const { affiliateName, affiliateEmail, clientFirstName, clientLastName, clientEmail } = body;
    if (!affiliateName || !affiliateEmail || !clientFirstName || !clientLastName || !clientEmail) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(clientEmail)) {
      return new Response(
        JSON.stringify({ error: "Invalid client email format" }),
        { status: 400, headers }
      );
    }
    if (!emailRegex.test(affiliateEmail)) {
      return new Response(
        JSON.stringify({ error: "Invalid affiliate email format" }),
        { status: 400, headers }
      );
    }

    const GHL_API_KEY = context.env.GHL_API_KEY;
    if (!GHL_API_KEY) {
      console.error("[affiliate-refer] GHL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // ---- STEP 1: Upsert client contact ----
    const upsertPayload = {
      firstName: String(clientFirstName).slice(0, 100),
      lastName: String(clientLastName).slice(0, 100),
      email: String(clientEmail).slice(0, 200),
      phone: body.clientPhone ? String(body.clientPhone).slice(0, 20) : undefined,
      locationId: GHL_LOCATION_ID,
      tags: ["affiliate-referral"],
      source: `Affiliate Referral - ${String(affiliateName).slice(0, 100)}`,
    };

    const upsertResponse = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: ghlHeaders(GHL_API_KEY),
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      console.error(`[affiliate-refer] GHL upsert error: ${upsertResponse.status} ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to save referral" }),
        { status: 422, headers }
      );
    }

    const upsertData = await upsertResponse.json();
    const contactId = upsertData.contact?.id;
    console.log(`[affiliate-refer] Contact upserted: ${contactId || "unknown"}`);

    // ---- STEP 2: Add note with affiliate details ----
    if (contactId) {
      const noteBody = [
        `Affiliate Referral from ${String(affiliateName).slice(0, 100)} (${String(affiliateEmail).slice(0, 200)})`,
        body.notes ? `Notes: ${String(body.notes).slice(0, 500)}` : null,
        `Submitted: ${new Date().toISOString()}`,
      ].filter(Boolean).join("\n");

      const noteResponse = await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({ body: noteBody }),
      });

      if (!noteResponse.ok) {
        const errorText = await noteResponse.text();
        console.error(`[affiliate-refer] GHL note error: ${noteResponse.status} ${errorText}`);
        // Don't fail — contact was created, note just didn't save
      } else {
        console.log(`[affiliate-refer] Note added for contact: ${contactId}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[affiliate-refer] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
