// Cloudflare Pages Function: GET /api/partner-stats?ref=Sarah
// Returns referral stats for a partner: total referrals, booked, completed sessions.
// Queries GHL contacts where referral_source matches the partner name.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { requireOwner } from "../lib/owned-access.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const REFERRAL_SOURCE_FIELD_ID = "htX3m1ba8ka7PU0OWISE";
// Spoof-proof link: affiliate-refer.js stamps each referred contact with the
// referring partner's GHL contact id in this field.
const PARTNER_CONTACT_ID_FIELD_ID = "Un0VeGngkiUJrZ0mrgDa";

// A referred contact belongs to a partner iff it carries that partner's GHL
// contact id (spoof-proof), OR — for legacy referrals created before that field
// existed — its free-text referral_source matches the partner's own name.
// The contactId match is what closes the cross-partner IDOR (E#1); the name
// fallback preserves historical referrals from before the id was stamped.
export function partnerOwnsContact(contact, partnerContactId, partnerName) {
  const customFields = (contact && contact.customFields) || [];
  if (partnerContactId) {
    const pidField = customFields.find((f) => f.id === PARTNER_CONTACT_ID_FIELD_ID);
    if (pidField && String(pidField.value) === String(partnerContactId)) return true;
  }
  if (partnerName) {
    const refField = customFields.find((f) => f.id === REFERRAL_SOURCE_FIELD_ID);
    if (refField && String(refField.value).toLowerCase() === String(partnerName).toLowerCase()) return true;
  }
  return false;
}

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    // ── Authorization: a partner may only ever see THEIR OWN referrals. ──
    // Identity comes from the signed token (contactId), NEVER from a client-
    // supplied ?ref= name. Trusting ?ref= was an IDOR (E#1, 2026-07-04): any
    // partner could read any other partner's referral list + referred-client PII.
    //
    // Bearer + verify + partner-audience + per-contact revoke are centralized in
    // lib/owned-access.js so this endpoint can't drift from the rest of the
    // partner surface. (Routing through the gate also ADDS the revoke check this
    // endpoint previously lacked.)
    const gate = await requireOwner(context, headers, {
      audience: "partner",
      messages: { wrongAudience: "Partner access required" },
    });
    if (gate.error) return gate.error;
    const partnerContactId = gate.contactId;

    const GHL_API_KEY = await getGhlToken(context);
    if (!GHL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Derive the partner's authoritative referral name from their OWN contact
    // record (same resolution affiliate-refer.js uses when stamping referrals).
    // Server-controlled, so it cannot be spoofed via the request.
    let partnerName = null;
    try {
      const partnerResponse = await fetch(`${GHL_API_BASE}/contacts/${partnerContactId}`, {
        method: "GET",
        headers: ghlHeaders(GHL_API_KEY),
      });
      if (partnerResponse.ok) {
        const partnerData = await partnerResponse.json();
        const pc = partnerData.contact || {};
        partnerName = pc.firstName
          ? pc.firstName.charAt(0).toUpperCase() + pc.firstName.slice(1).toLowerCase()
          : null;
      }
    } catch (err) {
      console.error(`[partner-stats] Partner profile lookup error: ${err.message}`);
    }

    if (!partnerName) {
      // Fail closed: without the partner's own name we cannot scope the search safely.
      return new Response(
        JSON.stringify({ error: "Could not load partner profile" }),
        { status: 422, headers }
      );
    }

    // Log (do not act on) a mismatched client-supplied ref — signals tampering.
    const requestedRef = (new URL(context.request.url).searchParams.get("ref") || "")
      .replace(/<[^>]*>/g, "").replace(/[^a-zA-Z\s\-']/g, "").trim();
    if (requestedRef && requestedRef.toLowerCase() !== partnerName.toLowerCase()) {
      console.warn(`[partner-stats] Ignoring ref='${requestedRef}' — scoping to authenticated partner ${partnerContactId} instead`);
    }

    // Search candidates by the trusted partner name, then authorize each contact
    // by identity (partner contactId stamp) with a legacy name-match fallback.
    const searchUrl = `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(partnerName)}&limit=100`;

    const searchResponse = await fetch(searchUrl, {
      method: "GET",
      headers: ghlHeaders(GHL_API_KEY),
    });

    if (!searchResponse.ok) {
      console.error(`[partner-stats] GHL search error: ${searchResponse.status}`);
      return new Response(
        JSON.stringify({ error: "Failed to fetch stats" }),
        { status: 422, headers }
      );
    }

    const searchData = await searchResponse.json();
    const allContacts = searchData.contacts || [];

    // Only contacts that belong to THIS partner (identity-scoped, not ref-scoped).
    const referrals = allContacts.filter((contact) =>
      partnerOwnsContact(contact, partnerContactId, partnerName)
    );

    // Now get appointment data for each referred contact
    let booked = 0;
    let completed = 0;
    const referralDetails = [];

    const appointmentPromises = referrals.map(async (contact) => {
      const detail = {
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        status: "referred", // default
      };

      try {
        const apptUrl = `${GHL_API_BASE}/contacts/${contact.id}/appointments`;
        const apptResponse = await fetch(apptUrl, {
          method: "GET",
          headers: ghlHeaders(GHL_API_KEY),
        });

        if (apptResponse.ok) {
          const apptData = await apptResponse.json();
          const appointments = apptData.events || apptData.appointments || [];

          if (appointments.length > 0) {
            detail.status = "booked";
            booked++;

            // Check if any appointment has status "showed" or "completed"
            const hasCompleted = appointments.some(
              (a) =>
                a.appointmentStatus === "showed" ||
                a.appointmentStatus === "completed"
            );
            if (hasCompleted) {
              detail.status = "completed";
              completed++;
              booked--; // don't double count
            }
          }
        }
      } catch (err) {
        console.error(`[partner-stats] Appointment fetch error for ${contact.id}: ${err.message}`);
      }

      return detail;
    });

    const details = await Promise.all(appointmentPromises);

    // Calculate streak (consecutive months with at least 1 referral)
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    let streak = 0;

    for (let i = 0; i < 12; i++) {
      const checkMonth = currentMonth - i;
      const checkYear = currentYear + Math.floor(checkMonth / 12);
      const normalizedMonth = ((checkMonth % 12) + 12) % 12;

      const hasReferralThisMonth = referrals.some((contact) => {
        const created = new Date(contact.dateAdded || contact.createdAt);
        return (
          created.getMonth() === normalizedMonth &&
          created.getFullYear() === checkYear
        );
      });

      if (hasReferralThisMonth) {
        streak++;
      } else {
        break;
      }
    }

    // Milestone calculation
    const total = referrals.length;
    let milestone = null;
    if (total >= 25) {
      milestone = { level: "Elite Partner", icon: "crown", threshold: 25 };
    } else if (total >= 10) {
      milestone = { level: "Pro Partner", icon: "fire", threshold: 10, next: 25 };
    } else if (total >= 5) {
      milestone = { level: "Rising Partner", icon: "star", threshold: 5, next: 10 };
    } else if (total >= 1) {
      milestone = { level: "Partner", icon: "check", threshold: 1, next: 5 };
    }

    return new Response(
      JSON.stringify({
        partner: partnerName,
        stats: {
          total,
          booked,
          completed,
          streak,
        },
        milestone,
        referrals: details.map((d) => ({
          name: d.firstName,
          status: d.status,
        })),
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[partner-stats] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
