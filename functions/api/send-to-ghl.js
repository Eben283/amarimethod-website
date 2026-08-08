// Cloudflare Pages Function: POST /api/send-to-ghl
// Receives quiz results from frontend and upserts contact in GHL
// Uses 2-step process: upsert contact, then PUT custom fields separately

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { emitNurtureEvent } from "../lib/engine-forward.js";

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

const TEXT_LIMITS = Object.freeze({
  firstName: 100,
  lastName: 100,
  email: 254,
  phone: 20,
  patternSignature: 120,
  primaryPainLocation: 160,
  painDuration: 240,
  treatmentsTried: 1200,
  painTrigger: 1200,
  additionalPainAreas: 1200,
  painIntensity: 240,
  painTiming: 1200,
  painType: 1200,
  aggravatingActivities: 1600,
  dailyImpact: 1600,
  treatmentResults: 1200,
  healthConditions: 1600,
});

const REFERRAL_SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(headers, body, status) {
  return new Response(JSON.stringify(body), { status, headers });
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function cleanText(value, key, { required = false } = {}) {
  if (value == null || value === "") return required ? null : "";
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > TEXT_LIMITS[key]) return null;
  return cleaned;
}

// The quiz is public, but it is still a narrowly defined lead-intake contract.
// Reject objects, oversized bodies, and arbitrary referral values before they can
// become GHL fields/tags. This does not authenticate an existing contact: a
// configured bot-verification gate remains the next required control for that.
export function normalizeQuizSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const normalized = {};
  for (const key of Object.keys(TEXT_LIMITS)) {
    const value = cleanText(body[key], key, {
      required: key === "firstName" || key === "lastName" || key === "email",
    });
    if (value == null) return null;
    normalized[key] = value;
  }

  normalized.email = normalized.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) return null;

  const score = Number(body.recoveryPotentialScore);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  normalized.recoveryPotentialScore = score;
  normalized.painSeverity = ["mild", "moderate", "severe"].includes(body.painSeverity)
    ? body.painSeverity
    : "moderate";

  if (body.scores != null) {
    if (!body.scores || typeof body.scores !== "object" || Array.isArray(body.scores)) return null;
    const scoreKeys = ["softTissueTension", "jointBoneAlignment", "patternDuration", "dailyActivitiesImpact", "bodyAdaptations"];
    normalized.scores = {};
    for (const key of scoreKeys) {
      const value = Number(body.scores[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) return null;
      normalized.scores[key] = value;
    }
  } else {
    normalized.scores = null;
  }

  if (body.insights != null) {
    if (!Array.isArray(body.insights) || body.insights.length > 4) return null;
    normalized.insights = [];
    for (const insight of body.insights) {
      if (!insight || typeof insight !== "object" || Array.isArray(insight)) return null;
      const title = typeof insight.title === "string" ? insight.title.trim() : "";
      const description = typeof insight.description === "string" ? insight.description.trim() : "";
      if (!title || !description || title.length > 160 || description.length > 1200) return null;
      normalized.insights.push({ title, description });
    }
  } else {
    normalized.insights = [];
  }

  if (body.referralSource != null && body.referralSource !== "") {
    if (typeof body.referralSource !== "string") return null;
    const referralSource = body.referralSource.trim();
    if (!REFERRAL_SOURCE_RE.test(referralSource)) return null;
    normalized.referralSource = referralSource;
  } else {
    normalized.referralSource = null;
  }

  return normalized;
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
    if (!isAllowedOrigin(origin)) {
      return json(headers, { error: "Submission must come from the Amari quiz." }, 403);
    }
    if (!context.request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      return json(headers, { error: "Expected a JSON quiz submission." }, 415);
    }

    const body = normalizeQuizSubmission(await context.request.json());
    if (!body) return json(headers, { error: "Invalid quiz submission." }, 400);
    const { firstName, lastName, email } = body;

    // Protect GHL from abuse without blocking legitimate people on a shared
    // network. Invalid or incomplete attempts must never consume this quota.
    // The new key deliberately clears the overly strict legacy 3/hour bucket.
    const kv = context.env.PORTAL_KV;
    if (kv) {
      const clientIP = context.request.headers.get("CF-Connecting-IP") || "unknown";
      const rateKey = `quiz_submission_rate:${clientIP}`;
      const currentCount = parseInt(await kv.get(rateKey) || "0", 10);
      if (currentCount >= 10) {
        return json(headers, { error: "Too many submissions from this network. Please try again in an hour." }, 429);
      }
      await kv.put(rateKey, String(currentCount + 1), { expirationTtl: 3600 });
    }

    const GHL_API_KEY = await getGhlToken(context);
    if (!GHL_API_KEY) {
      console.error("[send-to-ghl] GHL_API_KEY not configured");
      return json(headers, { error: "Server configuration error" }, 500);
    }

    // Build tags array
    const tags = ["quiz submitted"];
    const severity = body.painSeverity;
    if (severity === "mild") tags.push("pain-severity-mild");
    else if (severity === "severe") tags.push("pain-severity-severe");
    else tags.push("pain-severity-moderate");

    // Pain location tag — slugified primary pain location for audience targeting
    // (mirrors quiz_complete GA4 event param `pain_location`)
    const primaryPainLocation = body.primaryPainLocation
      ? String(body.primaryPainLocation).trim()
      : "";
    if (primaryPainLocation && primaryPainLocation !== "Unknown") {
      const locationSlug = primaryPainLocation
        .toLowerCase()
        .replace(/\s*\/\s*/g, "-")
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      if (locationSlug) tags.push(`pain-location-${locationSlug}`);
    }

    // Audience region tag — Bay Area vs Remote, derived from Cloudflare geo
    // headers. Used by the quiz result page to emphasize in-person vs virtual
    // CTAs, and by GHL workflows for audience-segmented nurture.
    const lat = parseFloat(context.request.headers.get("cf-iplatitude") || "");
    const lng = parseFloat(context.request.headers.get("cf-iplongitude") || "");
    let audience = null;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      // Haversine distance from SF (37.7749, -122.4194), 75-mile radius
      const SF_LAT = 37.7749;
      const SF_LNG = -122.4194;
      const R = 3958.8;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(lat - SF_LAT);
      const dLng = toRad(lng - SF_LNG);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(SF_LAT)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
      const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      audience = miles <= 75 ? "bay-area" : "remote";
      tags.push(`audience-${audience}`);
    }

    // Referral tracking
    const referralSource = body.referralSource;
    if (referralSource) {
      tags.push(`referred-by-${referralSource.toLowerCase()}`);
    }

    // ---- STEP 1: Upsert contact (create or find by email) ----
    // Only send basic contact info + tags + source
    // Custom fields are set in Step 2 via PUT (upsert doesn't reliably save them)
    const upsertPayload = {
      firstName,
      lastName,
      email,
      phone: body.phone || undefined,
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

    // Quiz-submitted event → nurture engine (Flow 1 entry). Fire-and-forget, dormant until
    // the NURTURE_ENGINE_URL Pages env exists (GHL exit — replaces the "quiz submitted" tag
    // trigger). Never delays or breaks the quiz response.
    if (contactId) {
      emitNurtureEvent(context, { kind: "quiz.submitted", contactId });
    }

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
      JSON.stringify({ success: true, audience }),
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
