// Cloudflare Pages Function: POST /api/jaw-study-signup
// Enrolls a contact into an Amari study (GHL contact upsert + tag). Study is read from the STUDIES registry.
// Sign-up captures name, phone, email, and an optional body-part — the outcome score
// and the rest of the intake happen at session 1, not here. See
// ops/drafts/tennis-elbow-study-plan.md for the full plan.

import { ghlFetch } from "../lib/ghl.js";
import { STUDIES } from "../lib/studies.js";
import { wantsPublishOptIn, STUDY_PUBLISH_OPT_IN_TAG } from "../lib/study-consent.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// This endpoint enrolls into one study from the registry. The display
// name written to the contact's Study Name field drives {{contact.study_name}}
// in the confirmation email + appointment reminders, so one GHL workflow can
// name whichever study the contact signed up for.
const STUDY = STUDIES["tmj"];
const STUDY_NAME_FIELD_ID = "1xhxStKyEN47shwjOKC0"; // GHL custom field "Study Name" (contact.study_name)

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

// One text field on the sign-up form covers the whole name (speed
// matters more than a first/last split), so split it server-side instead.
export function splitName(fullName) {
  const trimmed = String(fullName).trim().replace(/\s+/g, " ");
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

// Accepts loose real-world input (spaces, dashes, parens, leading +) and
// rejects anything that can't plausibly be a phone number once stripped down.
export function isValidPhone(phone) {
  const cleaned = String(phone).replace(/[^\d+]/g, "");
  return cleaned.length >= 10;
}

// Loose but real: one @, a dot in the domain, no whitespace. Enough to catch
// courts-iPad typos without rejecting valid-but-unusual addresses.
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
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
    // Rate limit per IP, not per session — Garrett may submit many sign-ups
    // in a row from the same iPad/network during one courts visit.
    const kv = context.env.PORTAL_KV;
    if (kv) {
      const clientIP = context.request.headers.get("CF-Connecting-IP") || "unknown";
      const rateKey = `jaw_study_signup_rate:${clientIP}`;
      const currentCount = parseInt((await kv.get(rateKey)) || "0", 10);
      if (currentCount >= 30) {
        return new Response(
          JSON.stringify({ error: "Too many submissions. Please try again later." }),
          { status: 429, headers },
        );
      }
      await kv.put(rateKey, String(currentCount + 1), { expirationTtl: 3600 });
    }

    const body = await context.request.json();
    const { name, phone, email, bodyPart, publishOptIn } = body;

    if (!name || !phone || !email) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: name, phone, email" }),
        { status: 400, headers },
      );
    }

    if (!isValidPhone(phone)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number" }),
        { status: 400, headers },
      );
    }
    const cleanPhone = String(phone).replace(/[^\d+]/g, "");

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email address" }),
        { status: 400, headers },
      );
    }
    const cleanEmail = String(email).trim().toLowerCase();

    const { firstName, lastName } = splitName(name);

    const tags = [STUDY.tag];
    const normalizedPart = bodyPart ? String(bodyPart).trim().toLowerCase() : "";
    if (["left", "right", "both"].includes(normalizedPart)) {
      tags.push(`${STUDY.slug}-${normalizedPart}`);
    }

    if (wantsPublishOptIn(publishOptIn)) {
      tags.push(STUDY_PUBLISH_OPT_IN_TAG);
    }

    const upsertPayload = {
      firstName: firstName.slice(0, 100),
      lastName: lastName.slice(0, 100),
      phone: cleanPhone.slice(0, 20),
      email: cleanEmail.slice(0, 254),
      locationId: GHL_LOCATION_ID,
      tags,
      source: STUDY.shortName,
      customFields: [{ id: STUDY_NAME_FIELD_ID, value: STUDY.shortName }],
    };

    const upsertResponse = await ghlFetch(context, `${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      console.error(`[jaw-study-signup] GHL upsert error: ${upsertResponse.status} ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to save sign-up" }),
        { status: 422, headers },
      );
    }

    const upsertData = await upsertResponse.json();
    console.log(`[jaw-study-signup] Contact upserted: ${upsertData.contact?.id || "unknown"}`);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[jaw-study-signup] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers },
    );
  }
}
