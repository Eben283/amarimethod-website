// Cloudflare Pages Function: POST /api/affiliate-refer
// Receives an authenticated Partner Portal referral, creates/upserts the
// referred contact in GHL, and records the signed-in partner as its source.
// The partner identity is always derived from the verified session, never from
// a request-supplied name, email, or reference.

import { ghlHeaders } from "../lib/ghl.js";
import { loadOwnedContact } from "../lib/owned-access.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs
const REFERRAL_SOURCE_FIELD_ID = "htX3m1ba8ka7PU0OWISE";
const PARTNER_CONTACT_ID_FIELD_ID = "Un0VeGngkiUJrZ0mrgDa";
const REFERRAL_TYPE_FIELD_ID = "uIxbS5OTNziajtkEhukJ";
const REFERRAL_FEE_STATUS_FIELD_ID = "WVoFlhWeVW7h353R1Sfy";

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
    const owned = await loadOwnedContact(context, headers, {
      audience: "partner",
      requireTag: "affiliate-partner",
    });
    if (owned.error) return owned.error;
    const { tokenPayload, contactId: resolvedPartnerContactId, contact: partner, ghlToken: GHL_API_KEY } = owned;

    const body = await context.request.json();
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

    const affiliateName = partner.firstName
      ? partner.firstName.charAt(0).toUpperCase() + partner.firstName.slice(1).toLowerCase()
      : "Partner";
    const affiliateEmail = partner.email || tokenPayload.email || "";

    // ---- STEP 1: Upsert client contact ----
    // Partners now introduce clients to Amari; they do not sell a session or
    // collect client payment. Keep the legacy field at its only valid value
    // until the payout lifecycle is fully migrated.
    const referralType = "refer";

    const referralCustomFields = [
      { id: REFERRAL_SOURCE_FIELD_ID, field_value: affiliateName },
    ];
    if (resolvedPartnerContactId) {
      referralCustomFields.push({ id: PARTNER_CONTACT_ID_FIELD_ID, field_value: resolvedPartnerContactId });
    }
    if (REFERRAL_TYPE_FIELD_ID) {
      referralCustomFields.push({ id: REFERRAL_TYPE_FIELD_ID, field_value: referralType });
    }
    // Set fee status to "unpaid" for refer-path only (partner is owed $50)
    if (REFERRAL_FEE_STATUS_FIELD_ID && referralType === "refer") {
      referralCustomFields.push({ id: REFERRAL_FEE_STATUS_FIELD_ID, field_value: "unpaid" });
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
      const noteParts = [
        `Affiliate Referral from partner: ${affiliateName}${affiliateEmail ? ` (${affiliateEmail})` : ""}`,
        `Referral type: ${referralType}`,
        body.painArea ? `Pain area: ${String(body.painArea).slice(0, 200)}` : null,
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
