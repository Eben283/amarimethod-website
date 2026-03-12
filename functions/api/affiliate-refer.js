// Cloudflare Pages Function: POST /api/affiliate-refer
// Receives affiliate referral form data, creates/upserts contact in GHL,
// tags with affiliate-referral, and adds a note with affiliate details.
//
// Accepts two payload formats:
// NEW (simplified): { affiliateRef, clientFirstName, clientPhone, painArea }
// OLD (legacy):     { affiliateName, affiliateEmail, clientFirstName, clientLastName, clientEmail, clientPhone, notes }
//
// If an Authorization: Bearer header is present, partner identity is resolved
// from the session token (more accurate than affiliateRef field).

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs
const REFERRAL_SOURCE_FIELD_ID = "htX3m1ba8ka7PU0OWISE";
const PARTNER_CONTACT_ID_FIELD_ID = "Un0VeGngkiUJrZ0mrgDa";
// TODO: Create "Referral Type" custom field in GHL (dropdown: refer / sold), then paste ID here
const REFERRAL_TYPE_FIELD_ID = null; // ← Replace with GHL field ID once created

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

// Verify session token (optional — used when partner is authenticated)
async function verifySessionToken(tokenString, secret) {
  try {
    const parts = tokenString.split(".");
    if (parts.length !== 3) return null;

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
    if (!valid) return null;

    const payload = JSON.parse(atob(body));
    if (!payload.exp || Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
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

    const GHL_API_KEY = await getGhlToken(context);
    const JWT_SECRET = context.env.JWT_SECRET;

    if (!GHL_API_KEY) {
      console.error("[affiliate-refer] GHL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // ── Resolve partner identity ──
    // Priority: Bearer token > body.affiliateName > body.affiliateRef
    let resolvedPartnerName = null;
    let resolvedPartnerEmail = null;
    let resolvedPartnerContactId = null;

    const authHeader = context.request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ") && JWT_SECRET) {
      const tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
      if (tokenPayload && tokenPayload.contactId) {
        resolvedPartnerContactId = tokenPayload.contactId;
        try {
          const partnerResponse = await fetch(`${GHL_API_BASE}/contacts/${tokenPayload.contactId}`, {
            headers: ghlHeaders(GHL_API_KEY),
          });
          if (partnerResponse.ok) {
            const partnerData = await partnerResponse.json();
            const pc = partnerData.contact;
            resolvedPartnerName = pc.firstName
              ? pc.firstName.charAt(0).toUpperCase() + pc.firstName.slice(1).toLowerCase()
              : null;
            resolvedPartnerEmail = pc.email || tokenPayload.email;
            console.log(`[affiliate-refer] Resolved partner from token: ${resolvedPartnerName} (${resolvedPartnerContactId})`);
          }
        } catch (err) {
          console.error(`[affiliate-refer] Token partner lookup error: ${err.message}`);
        }
      }
    }

    // Detect payload format: new (affiliateRef) vs old (affiliateName + affiliateEmail)
    const isNewFormat = body.affiliateRef !== undefined;

    // Final affiliate name: token-resolved > body field
    const affiliateName = resolvedPartnerName
      || (isNewFormat ? String(body.affiliateRef || "unknown").slice(0, 100) : String(body.affiliateName || "").slice(0, 100));
    const affiliateEmail = resolvedPartnerEmail || body.affiliateEmail || "";

    // Validate required fields based on format
    if (isNewFormat || resolvedPartnerName) {
      // Simplified flow: only need client name + phone
      if (!body.clientFirstName || !body.clientPhone) {
        return new Response(
          JSON.stringify({ error: "Client name and phone are required" }),
          { status: 400, headers }
        );
      }
      const phoneDigitCount = (String(body.clientPhone).match(/\d/g) || []).length;
      if (phoneDigitCount < 10) {
        return new Response(
          JSON.stringify({ error: "Phone number must have at least 10 digits" }),
          { status: 400, headers }
        );
      }
    } else {
      // Legacy format validation
      const { clientFirstName, clientLastName, clientEmail } = body;
      if (!affiliateName || !affiliateEmail || !clientFirstName || !clientLastName || !clientEmail) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers }
        );
      }
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
    }

    // ---- STEP 1: Upsert client contact ----
    const referralType = (body.referralType === "sold" || body.referralType === "refer")
      ? body.referralType
      : "refer"; // default to refer if missing

    const referralCustomFields = [
      { id: REFERRAL_SOURCE_FIELD_ID, field_value: affiliateName },
    ];
    if (resolvedPartnerContactId) {
      referralCustomFields.push({ id: PARTNER_CONTACT_ID_FIELD_ID, field_value: resolvedPartnerContactId });
    }
    if (REFERRAL_TYPE_FIELD_ID) {
      referralCustomFields.push({ id: REFERRAL_TYPE_FIELD_ID, field_value: referralType });
    }

    const upsertPayload = {
      firstName: String(body.clientFirstName).slice(0, 100),
      locationId: GHL_LOCATION_ID,
      tags: ["affiliate-referral"],
      source: `Affiliate Referral - ${affiliateName}`,
      customFields: referralCustomFields,
    };
    if (body.clientLastName) upsertPayload.lastName = String(body.clientLastName).slice(0, 100);
    if (body.clientEmail) upsertPayload.email = String(body.clientEmail).slice(0, 200);
    if (body.clientPhone) upsertPayload.phone = String(body.clientPhone).slice(0, 20);

    console.log(`[affiliate-refer] Referral type: ${referralType}, partner: ${affiliateName}`);

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

    // ---- STEP 2: Add note with referral details ----
    if (contactId) {
      const noteParts = isNewFormat || resolvedPartnerName
        ? [
            `Affiliate Referral from partner: ${affiliateName}${affiliateEmail ? ` (${affiliateEmail})` : ""}`,
            `Referral type: ${referralType}`,
            body.painArea ? `Pain area: ${String(body.painArea).slice(0, 200)}` : null,
            `Submitted: ${new Date().toISOString()}`,
          ]
        : [
            `Affiliate Referral from ${String(affiliateName).slice(0, 100)}${affiliateEmail ? ` (${String(affiliateEmail).slice(0, 200)})` : ""}`,
            body.notes ? `Notes: ${String(body.notes).slice(0, 500)}` : null,
            `Submitted: ${new Date().toISOString()}`,
          ];

      const noteBody = noteParts.filter(Boolean).join("\n");

      const noteResponse = await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({ body: noteBody }),
      });

      if (!noteResponse.ok) {
        const errorText = await noteResponse.text();
        console.error(`[affiliate-refer] GHL note error: ${noteResponse.status} ${errorText}`);
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
