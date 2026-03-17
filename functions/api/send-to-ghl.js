// Cloudflare Pages Function: POST /api/send-to-ghl
// Receives quiz results from frontend and upserts contact in GHL
// Uses 2-step process: upsert contact, then PUT custom fields separately

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs (created via GHL API)
// Existing fields
const FIELD_IDS = {
  painPatternSignature: "BvTGZ9O9ayecw5f0Nj76",
  recoveryPotentialScore: "PhQQjTF1fiLgtnAgKZZP",
  primaryPainLocation: "vKZTVAG7601lgV8413du",
  painDuration: "wrYzlW0ta2SGD8cI5iTM",
  treatmentsTried: "y5HBXMycSnfFPSOcnR2y",
  painTrigger: "NaNk1OVQLu8CcONUnyNz",
  // New fields (created 2026-02-26)
  additionalPainAreas: "NCDnl1jHDvDATpRKhkeV",
  painIntensity: "iCMhoomSzLnCUCcludwD",
  painTiming: "bUuxBmrMuu2Zm9QrNTng",
  painType: "tIIxUQT8hrkpDYY3WhWn",
  aggravatingActivities: "IqxEaCTcZpvGuDUC3O9c",
  dailyImpact: "zin4frkDKBWvVoN7ztZW",
  treatmentResults: "1MSGnUASa5Zd9lKoNdvO",
  healthConditions: "Uw1MeObXs3xKJGh1KGNu",
  quizResultsSummary: "fE6XF0OEaq09v6clDhzq",
  referralSource: "htX3m1ba8ka7PU0OWISE",
};

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };
  }
  const allowedOrigin = origin;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// Build the formatted quiz results summary for GHL (used for text to Garrett)
function buildResultsSummary(body) {
  const lines = [];

  lines.push(`Quiz Results — ${body.firstName} ${body.lastName}`);
  lines.push('');
  lines.push(`Pattern: ${body.patternSignature || 'Unknown'}`);
  lines.push(`Recovery Potential: ${body.recoveryPotentialScore || 0}%`);

  // Scores
  if (body.scores) {
    const s = body.scores;
    lines.push('');
    lines.push('Scores:');
    lines.push(`Soft Tissue: ${s.softTissueTension} | Joint/Bone: ${s.jointBoneAlignment} | Duration: ${s.patternDuration} | Daily Impact: ${s.dailyActivitiesImpact} | Adaptations: ${s.bodyAdaptations}`);
  }

  // Insights
  if (body.insights && body.insights.length > 0) {
    lines.push('');
    lines.push('Insights:');
    body.insights.forEach((insight, i) => {
      lines.push(`${i + 1}. ${insight.title} — ${insight.description}`);
    });
  }

  // All answers
  lines.push('');
  lines.push('Answers:');
  lines.push(`Pain Location: ${body.primaryPainLocation || 'N/A'}`);
  lines.push(`Trigger: ${body.painTrigger || 'N/A'}`);
  if (body.additionalPainAreas) lines.push(`Additional Areas: ${body.additionalPainAreas}`);
  lines.push(`Duration: ${body.painDuration || 'N/A'}`);
  lines.push(`Intensity: ${body.painIntensity || 'N/A'}`);
  if (body.painTiming) lines.push(`Timing: ${body.painTiming}`);
  if (body.painType) lines.push(`Pain Type: ${body.painType}`);
  if (body.aggravatingActivities) lines.push(`Makes It Worse: ${body.aggravatingActivities}`);
  if (body.dailyImpact) lines.push(`Life Impact: ${body.dailyImpact}`);
  if (body.treatmentsTried) lines.push(`Treatments Tried: ${body.treatmentsTried}`);
  if (body.treatmentResults) lines.push(`Treatment Results: ${body.treatmentResults}`);
  if (body.healthConditions) lines.push(`Health Conditions: ${body.healthConditions}`);

  return lines.join('\n');
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

    const GHL_API_KEY = await getGhlToken(context);
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

    // Referral tracking
    const referralSource = body.referralSource ? String(body.referralSource).trim() : null;
    if (referralSource) {
      tags.push(`referred-by-${referralSource.toLowerCase()}`);
    }

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
      source: referralSource
        ? `Pain Assessment Quiz (ref: ${referralSource})`
        : "Pain Assessment Quiz",
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
        { status: 422, headers }
      );
    }

    const upsertData = await upsertResponse.json();
    const contactId = upsertData.contact?.id;
    console.log(`[send-to-ghl] Contact upserted: ${contactId || "unknown"}`);

    // ---- STEP 2: Update custom fields via PUT ----
    // This is a separate call because upsert doesn't reliably save custom fields
    if (contactId) {
      // Build the formatted summary
      const resultsSummary = buildResultsSummary(body);

      const customFields = [
        // Existing fields
        { id: FIELD_IDS.painPatternSignature, field_value: String(body.patternSignature || "Unknown") },
        { id: FIELD_IDS.recoveryPotentialScore, field_value: Number(body.recoveryPotentialScore) || 0 },
        { id: FIELD_IDS.primaryPainLocation, field_value: String(body.primaryPainLocation || "Unknown") },
        { id: FIELD_IDS.painDuration, field_value: String(body.painDuration || "") },
        { id: FIELD_IDS.treatmentsTried, field_value: String(body.treatmentsTried || "") },
        { id: FIELD_IDS.painTrigger, field_value: String(body.painTrigger || "") },
        // New answer fields
        { id: FIELD_IDS.additionalPainAreas, field_value: String(body.additionalPainAreas || "") },
        { id: FIELD_IDS.painIntensity, field_value: String(body.painIntensity || "") },
        { id: FIELD_IDS.painTiming, field_value: String(body.painTiming || "") },
        { id: FIELD_IDS.painType, field_value: String(body.painType || "") },
        { id: FIELD_IDS.aggravatingActivities, field_value: String(body.aggravatingActivities || "") },
        { id: FIELD_IDS.dailyImpact, field_value: String(body.dailyImpact || "") },
        { id: FIELD_IDS.treatmentResults, field_value: String(body.treatmentResults || "") },
        { id: FIELD_IDS.healthConditions, field_value: String(body.healthConditions || "") },
        // Full formatted summary
        { id: FIELD_IDS.quizResultsSummary, field_value: resultsSummary },
      ];

      // Add referral source if present
      if (referralSource) {
        customFields.push({ id: FIELD_IDS.referralSource, field_value: referralSource });
      }

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
