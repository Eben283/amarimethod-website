// Cloudflare Pages Function: POST /api/send-to-ghl
// Receives quiz results from frontend and upserts contact in GHL
// Uses 2-step process: upsert contact, then PUT custom fields separately

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs (created via GHL API)
const FIELD_IDS = {
  painPatternSignature: "BvTGZ9O9ayecw5f0Nj76",
  recoveryPotentialScore: "PhQQjTF1fiLgtnAgKZZP",
  primaryPainLocation: "vKZTVAG7601lgV8413du",
  painDuration: "wrYzlW0ta2SGD8cI5iTM",
  treatmentsTried: "y5HBXMycSnfFPSOcnR2y",
  painTrigger: "NaNk1OVQLu8CcONUnyNz",
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

    const GHL_API_KEY = context.env.GHL_API_KEY;
    if (!GHL_API_KEY) {
      console.error("[send-to-ghl] GHL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Build tags array
    const tags = ["quiz submitted"];
    const severity = body.painSeverity;
    if (severity === "mild") tags.push("pain-severity-mild");
    else if (severity === "severe") tags.push("pain-severity-severe");
    else tags.push("pain-severity-moderate");

    // ---- STEP 1: Upsert contact (create or find by email) ----
    // Only send basic contact info + tags + source
    // Custom fields are set in Step 2 via PUT (upsert doesn't reliably save them)
    const upsertPayload = {
      firstName: String(firstName).slice(0, 100),
      lastName: String(lastName).slice(0, 100),
      email: String(email).slice(0, 200),
      phone: body.phone ? String(body.phone).slice(0, 20) : undefined,
      locationId: GHL_LOCATION_ID,
      tags,
      source: "Pain Assessment Quiz",
    };

    const upsertResponse = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: ghlHeaders(GHL_API_KEY),
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      console.error(`[send-to-ghl] GHL upsert error: ${upsertResponse.status} ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to save contact" }),
        { status: 502, headers }
      );
    }

    const upsertData = await upsertResponse.json();
    const contactId = upsertData.contact?.id;
    console.log(`[send-to-ghl] Contact upserted: ${contactId || "unknown"}`);

    // ---- STEP 2: Update custom fields via PUT ----
    // This is a separate call because upsert doesn't reliably save custom fields
    if (contactId) {
      const customFields = [
        { id: FIELD_IDS.painPatternSignature, field_value: String(body.patternSignature || "Unknown") },
        { id: FIELD_IDS.recoveryPotentialScore, field_value: Number(body.recoveryPotentialScore) || 0 },
        { id: FIELD_IDS.primaryPainLocation, field_value: String(body.primaryPainLocation || "Unknown") },
        { id: FIELD_IDS.painDuration, field_value: String(body.painDuration || "") },
        { id: FIELD_IDS.treatmentsTried, field_value: String(body.treatmentsTried || "") },
        { id: FIELD_IDS.painTrigger, field_value: String(body.painTrigger || "") },
      ];

      const updateResponse = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({ customFields }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error(`[send-to-ghl] GHL update error: ${updateResponse.status} ${errorText}`);
        // Don't fail the whole request — contact was created, custom fields just didn't save
      } else {
        console.log(`[send-to-ghl] Custom fields updated for contact: ${contactId}`);
      }
    }

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
