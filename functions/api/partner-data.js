// Cloudflare Pages Function: GET /api/partner-data
// Authenticated endpoint: verifies Bearer token, fetches partner info + referral stats from GHL

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { isContactRevoked } from "../lib/session-guard.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    const GHL_API_KEY = await getGhlToken(context);

    if (!JWT_SECRET || !GHL_API_KEY) {
      console.error("[partner-data] Missing env vars");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Verify auth token
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers }
      );
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Session expired. Please log in again." }),
        { status: 401, headers }
      );
    }

    const contactId = tokenPayload.contactId;

    // HIGH-2: assert the token came from the partner flow (audience), not just
    // that it's validly signed. Partner session tokens carry type:"partner"
    // (partner-verify.js); a client/staff token must not reach partner data.
    if (tokenPayload.type !== "partner") {
      return new Response(
        JSON.stringify({ error: "This area is for partners." }),
        { status: 403, headers }
      );
    }

    // HIGH-2: per-contact kill switch — lets us revoke one partner's live
    // sessions without rotating JWT_SECRET (which logs out everyone).
    if (await isContactRevoked(context.env.PORTAL_KV, contactId)) {
      return new Response(
        JSON.stringify({ error: "Session expired. Please log in again." }),
        { status: 401, headers }
      );
    }

    // Fetch partner's own contact details from GHL
    const contactResponse = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      headers: ghlHeaders(GHL_API_KEY),
    });

    if (!contactResponse.ok) {
      console.error(`[partner-data] GHL contact fetch error: ${contactResponse.status}`);
      return new Response(
        JSON.stringify({ error: "Unable to load your data. Please try again." }),
        { status: 422, headers }
      );
    }

    const contactData = await contactResponse.json();
    const contact = contactData.contact;

    // HIGH-2: re-verify partner eligibility on EVERY read, not just at login.
    // The contact is already fetched, so this is free. Stripping the
    // affiliate-partner tag now revokes access on the next request (was: the
    // tag was checked only at partner-auth, so a revoked partner kept access
    // for up to the 30-day session).
    if (!(contact.tags || []).includes("affiliate-partner")) {
      return new Response(
        JSON.stringify({ error: "Your partner access is no longer active." }),
        { status: 403, headers }
      );
    }

    const capitalize = (s) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

    const partnerFirstName = capitalize(contact.firstName) || "Partner";
    const partnerLastName = capitalize(contact.lastName) || "";
    const partnerEmail = contact.email || tokenPayload.email;

    // ── Search for referrals ──
    // Primary: POST /contacts/search by partner_contact_id field (exact, collision-free)
    // Fallback: GET /contacts/ by name, filtered by referral_source (for pre-fix records)
    // Results are merged and deduplicated by contact ID.

    const seen = new Set();
    let referrals = [];

    // Primary search — by partner contactId field, paginated to handle any referral count.
    // Two stop conditions: (1) batch smaller than PAGE_LIMIT = final page;
    // (2) full page returned but no new contacts added = GHL ignores the page param,
    //     preventing an infinite loop if pagination is unsupported.
    try {
      const PAGE_LIMIT = 100;
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const prevCount = referrals.length;
        const idSearchResponse = await fetch(`${GHL_API_BASE}/contacts/search`, {
          method: "POST",
          headers: ghlHeaders(GHL_API_KEY),
          body: JSON.stringify({
            locationId: GHL_LOCATION_ID,
            filters: [{ field: PARTNER_CONTACT_ID_FIELD_ID, operator: "eq", value: contactId }],
            limit: PAGE_LIMIT,
            page,
          }),
        });
        if (!idSearchResponse.ok) break;
        const idSearchData = await idSearchResponse.json();
        const batch = idSearchData.contacts || [];
        for (const c of batch) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            referrals.push(c);
          }
        }
        // Continue only if we got a full page AND at least one new contact was added.
        // The second condition guards against infinite loops if GHL ignores the page param.
        hasMore = batch.length === PAGE_LIMIT && referrals.length > prevCount;
        page++;
      }
      console.log(`[partner-data] contactId search returned ${referrals.length} referrals`);
    } catch (err) {
      console.error(`[partner-data] contactId search error: ${err.message}`);
    }

    // Fallback — name-based search for referrals submitted before the contactId fix
    try {
      const nameSearchUrl = `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(partnerFirstName)}&limit=100`;
      const nameSearchResponse = await fetch(nameSearchUrl, { headers: ghlHeaders(GHL_API_KEY) });
      if (nameSearchResponse.ok) {
        const nameSearchData = await nameSearchResponse.json();
        const nameMatches = (nameSearchData.contacts || []).filter((c) => {
          const refField = (c.customFields || []).find((f) => f.id === REFERRAL_SOURCE_FIELD_ID);
          return refField && String(refField.value).toLowerCase() === partnerFirstName.toLowerCase();
        });
        for (const c of nameMatches) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            referrals.push(c);
          }
        }
        console.log(`[partner-data] name fallback added ${referrals.length - seen.size + nameMatches.filter(c => seen.has(c.id)).length} new referrals`);
      }
    } catch (err) {
      console.error(`[partner-data] name fallback search error: ${err.message}`);
    }

    // Get appointment data for each referred contact
    let booked = 0;
    let completed = 0;
    const referralDetails = [];

    const appointmentPromises = referrals.map(async (refContact) => {
      // Extract referral type and fee status from custom fields
      const customFields = refContact.customFields || [];
      const typeField = customFields.find((f) => f.id === REFERRAL_TYPE_FIELD_ID);
      const feeField = customFields.find((f) => f.id === REFERRAL_FEE_STATUS_FIELD_ID);
      const referralType = typeField?.value || "refer";
      const feeStatus = referralType === "refer" ? (feeField?.value || "unpaid") : null;

      const detail = {
        firstName: refContact.firstName || "",
        status: "referred",
        referralType,
        feeStatus,
      };

      try {
        const apptUrl = `${GHL_API_BASE}/contacts/${refContact.id}/appointments`;
        const apptResponse = await fetch(apptUrl, {
          method: "GET",
          headers: ghlHeaders(GHL_API_KEY),
        });

        if (apptResponse.ok) {
          const apptData = await apptResponse.json();
          const appointments =
            apptData.events || apptData.appointments || [];

          if (appointments.length > 0) {
            detail.status = "booked";
            booked++;

            const hasCompleted = appointments.some(
              (a) =>
                a.appointmentStatus === "showed" ||
                a.appointmentStatus === "completed"
            );
            if (hasCompleted) {
              detail.status = "completed";
              completed++;
              booked--;
            }
          }
        }
      } catch (err) {
        console.error(
          `[partner-data] Appointment fetch error for ${refContact.id}: ${err.message}`
        );
      }

      // 90-day expiry: if refer-path, no booking, and >90 days since referral → expired
      if (
        detail.referralType === "refer" &&
        detail.status === "referred" &&
        detail.feeStatus !== "expired"
      ) {
        const referredDate = new Date(refContact.dateAdded || refContact.createdAt);
        const daysSinceReferred = (Date.now() - referredDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceReferred > 90) {
          detail.feeStatus = "expired";
        }
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

      const hasReferralThisMonth = referrals.some((c) => {
        const created = new Date(c.dateAdded || c.createdAt);
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
      milestone = {
        level: "Pro Partner",
        icon: "fire",
        threshold: 10,
        next: 25,
      };
    } else if (total >= 5) {
      milestone = {
        level: "Rising Partner",
        icon: "star",
        threshold: 5,
        next: 10,
      };
    } else if (total >= 1) {
      milestone = {
        level: "Partner",
        icon: "check",
        threshold: 1,
        next: 5,
      };
    }

    return new Response(
      JSON.stringify({
        partner: {
          firstName: partnerFirstName,
          lastName: partnerLastName,
          email: partnerEmail,
          contactId: contact.id,
        },
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
          referralType: d.referralType,
          feeStatus: d.feeStatus, // "unpaid" | "paid" | null (null = sold path, no fee owed)
        })),
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[partner-data] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
