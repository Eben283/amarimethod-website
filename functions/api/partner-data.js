// Cloudflare Pages Function: GET /api/partner-data
// Authenticated endpoint: verifies Bearer token, fetches partner info + referral stats from GHL

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

// Verify session token
async function verifySessionToken(tokenString, secret) {
  const parts = tokenString.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

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

  const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(data));
  if (!valid) throw new Error("Invalid signature");

  const payload = JSON.parse(atob(body));

  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
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
    const GHL_API_KEY = context.env.GHL_API_KEY;

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

    const capitalize = (s) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

    const partnerFirstName = capitalize(contact.firstName) || "Partner";
    const partnerEmail = contact.email || tokenPayload.email;

    // Search for referrals: contacts whose referral_source custom field matches this partner
    const searchUrl = `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(partnerFirstName)}&limit=100`;

    const searchResponse = await fetch(searchUrl, {
      method: "GET",
      headers: ghlHeaders(GHL_API_KEY),
    });

    let referrals = [];
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const allContacts = searchData.contacts || [];

      // Filter to only contacts whose referral_source custom field matches this partner
      referrals = allContacts.filter((c) => {
        const customFields = c.customFields || [];
        const refField = customFields.find(
          (f) => f.id === REFERRAL_SOURCE_FIELD_ID
        );
        if (!refField) return false;
        return (
          String(refField.value).toLowerCase() ===
          partnerFirstName.toLowerCase()
        );
      });
    }

    // Get appointment data for each referred contact
    let booked = 0;
    let completed = 0;
    const referralDetails = [];

    const appointmentPromises = referrals.map(async (refContact) => {
      const detail = {
        firstName: refContact.firstName || "",
        status: "referred",
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
