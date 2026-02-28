// Cloudflare Pages Function: GET /api/partner-stats?ref=Sarah
// Returns referral stats for a partner: total referrals, booked, completed sessions.
// Queries GHL contacts where referral_source matches the partner name.

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const REFERRAL_SOURCE_FIELD_ID = "htX3m1ba8ka7PU0OWISE";

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

function ghlHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
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
    const url = new URL(context.request.url);
    const ref = url.searchParams.get("ref");

    if (!ref || ref.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing ref parameter" }),
        { status: 400, headers }
      );
    }

    const partnerName = ref.replace(/<[^>]*>/g, "").replace(/[^a-zA-Z\s\-']/g, "").trim();
    if (!partnerName) {
      return new Response(
        JSON.stringify({ error: "Invalid ref parameter" }),
        { status: 400, headers }
      );
    }

    const GHL_API_KEY = context.env.GHL_API_KEY;
    if (!GHL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Search for all contacts with this referral_source
    // GHL search supports querying by custom field values
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

    // Filter to only contacts whose referral_source custom field matches this partner
    const referrals = allContacts.filter((contact) => {
      const customFields = contact.customFields || [];
      const refField = customFields.find(
        (f) => f.id === REFERRAL_SOURCE_FIELD_ID
      );
      if (!refField) return false;
      return String(refField.value).toLowerCase() === partnerName.toLowerCase();
    });

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
