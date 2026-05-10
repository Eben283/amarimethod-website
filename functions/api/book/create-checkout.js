/**
 * POST /api/book/create-checkout
 *
 * Upserts the GHL contact with the form data + the picked slot (stored
 * on `requested_session_*` custom fields), then returns the GHL payment
 * link URL the browser should redirect to. Payment happens on GHL — GHL
 * saves the card to its native Payment Methods panel, records the order
 * automatically, and fires the existing "Order Submitted" workflow chain.
 *
 * The actual appointment is booked by ghl-purchase-webhook.js when GHL
 * fires the order-submitted webhook — that handler reads the contact's
 * `requested_session_slot` field and calls /calendars/events/appointments
 * to put the appointment on the calendar at the picked time.
 *
 * No Stripe API keys / webhook secrets needed for this flow. GHL ↔ Stripe
 * Connect handles all the payment plumbing.
 */

import { ghlFetch, ghlHeaders, getGhlToken } from "../../lib/ghl.js";

const ALLOWED_ORIGIN = "https://www.amarimethod.com";
const DEFAULT_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Booking configuration. Each entry maps a sessionType (from the booking
// page) to the GHL payment link URL the customer should be redirected to
// after we've prepped the contact + stored the slot info on them.
//
// productId references GHL Products (see lib/ghl-products.js) so the
// purchase webhook can recognize this payment as an initial-session
// booking and create the appointment.
const ALLOWED_BOOKINGS = {
  initial_in_person: {
    calendarId: "G7OAnnJuFbMF6nQSlZVQ",
    productId: "688a1cd770362828afbf08a2",
    price: 225,
    title: "Amari Method Initial Session — In Person",
    durationMinutes: 60,
    pmaTag: "agreed-pma-v2026-04-17",
    sessionTag: "booked-initial-in-person",
    paymentLinkUrl:
      "https://link.amarimethod.com/payment-link/6a00f7c1c959774531bed6b6",
  },
  initial_virtual: {
    calendarId: "ySmht5hx4uZGEpgZrlCw",
    productId: "690b6b4d333ffa59d40c1823",
    price: 225,
    title: "Amari Method Initial Session — Virtual",
    durationMinutes: 60,
    pmaTag: "agreed-pma-v2026-04-17",
    sessionTag: "booked-initial-virtual",
    paymentLinkUrl:
      "https://link.amarimethod.com/payment-link/6a00f80c1d5a394a682e3fcb",
  },
};

function corsHeaders(requestOrigin) {
  const allow = requestOrigin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data, status, requestOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(requestOrigin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || ""),
  });
}

function validateBody(b) {
  if (!b || typeof b !== "object") return "Invalid body";
  const required = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "calendarId",
    "sessionType",
    "startTime",
    "timezone",
  ];
  for (const k of required) {
    if (!b[k] || typeof b[k] !== "string") return `Missing ${k}`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return "Invalid email";
  if (b.phone.replace(/\D/g, "").length < 10) return "Invalid phone";
  // agreeCommunications is optional — only the policies/PMA agreement is required
  if (!b.agreePolicies) {
    return "Missed Appointment Policy + Practice Membership Agreement must be agreed to";
  }
  if (!ALLOWED_BOOKINGS[b.sessionType]) return "Invalid sessionType";
  if (ALLOWED_BOOKINGS[b.sessionType].calendarId !== b.calendarId) {
    return "Calendar does not match sessionType";
  }
  return null;
}

/**
 * Find existing contact by email or create a new one. Returns the contactId.
 * Sets the slot-request custom fields + communications consent in the same
 * PUT/POST so the GHL purchase webhook has everything it needs once the
 * order lands.
 */
async function upsertContact(context, GHL_API_KEY, locationId, payload, booking) {
  const lookupUrl = `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(payload.email)}`;
  let existingId = null;
  try {
    const lookupRes = await fetch(lookupUrl, {
      headers: ghlHeaders(GHL_API_KEY),
    });
    if (lookupRes.ok) {
      const lookupData = await lookupRes.json();
      existingId =
        lookupData?.contact?.id ||
        (Array.isArray(lookupData?.contacts) && lookupData.contacts[0]?.id) ||
        null;
    }
  } catch (err) {
    console.error("[book/create-checkout] contact lookup failed:", err);
  }

  // Slot-request fields drive what the purchase webhook books after payment.
  // Field keys must exist in GHL Settings → Custom Fields → Object: Contact.
  const customFields = [
    {
      key: "requested_session_slot",
      field_value: payload.startTime,
    },
    {
      key: "requested_session_calendar",
      field_value: booking.calendarId,
    },
    {
      key: "requested_session_type",
      field_value: payload.sessionType,
    },
  ];
  if (payload.agreeCommunications) {
    customFields.push({
      key: "communications_policies_new_client",
      field_value: "true",
    });
  }

  if (existingId) {
    const updateRes = await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${existingId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          firstName: payload.firstName,
          lastName: payload.lastName,
          phone: payload.phone,
          customFields,
        }),
      },
    );
    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(
        `[book/create-checkout] contact update ${updateRes.status}: ${errText}`,
      );
    }
    return existingId;
  }

  const createRes = await ghlFetch(
    context,
    "https://services.leadconnectorhq.com/contacts/",
    {
      method: "POST",
      body: JSON.stringify({
        locationId,
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        phone: payload.phone,
        customFields,
        source: "Native booking flow",
      }),
    },
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`GHL contact create failed (${createRes.status}): ${errText}`);
  }

  const createData = await createRes.json();
  const id = createData?.contact?.id || createData?.id;
  if (!id) throw new Error("GHL contact create returned no id");
  return id;
}

/**
 * Add tags + a clickwrap audit note. Best-effort — non-fatal if either
 * fails. Tags help the purchase webhook + GHL workflows identify how the
 * contact arrived, even before payment lands.
 */
async function recordPreCheckoutAudit(context, contactId, payload, ip, ua, booking) {
  try {
    await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      {
        method: "POST",
        body: JSON.stringify({
          tags: [booking.pmaTag, "native-booking-started"],
        }),
      },
    );
  } catch (err) {
    console.error("[book/create-checkout] tag add failed:", err);
  }

  const noteBody = [
    `Native booking flow — checkout initiated`,
    ``,
    `Session: ${booking.title}`,
    `Requested slot: ${payload.startTime} (${payload.timezone})`,
    `Agreement version: ${payload.agreementVersion || "unspecified"}`,
    `Communications consent: ${payload.agreeCommunications ? "yes" : "no (optional, declined)"}`,
    `Practice Member Agreement: yes (clickwrap)`,
    `Missed Appointment Policy: yes (clickwrap)`,
    `IP: ${ip || "unknown"}`,
    `User agent: ${(ua || "").slice(0, 200)}`,
    `Captured at: ${new Date().toISOString()}`,
    ``,
    `Next: customer redirected to GHL payment link. Appointment will be`,
    `booked automatically when the order is paid.`,
  ].join("\n");

  try {
    await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ body: noteBody }),
      },
    );
  } catch (err) {
    console.error("[book/create-checkout] note add failed:", err);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, origin);
  }

  const validationError = validateBody(body);
  if (validationError) return json({ error: validationError }, 400, origin);

  const booking = ALLOWED_BOOKINGS[body.sessionType];
  const locationId = env.GHL_LOCATION_ID || DEFAULT_LOCATION_ID;
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "";
  const userAgent = request.headers.get("User-Agent") || "";

  let contactId;
  try {
    const GHL_API_KEY = await getGhlToken(context);
    contactId = await upsertContact(
      context,
      GHL_API_KEY,
      locationId,
      body,
      booking,
    );
  } catch (err) {
    console.error("[book/create-checkout] contact upsert failed:", err);
    return json(
      { error: "Could not save your details. Please try again." },
      422,
      origin,
    );
  }

  // Tags + audit note in parallel — neither blocks the redirect to payment.
  context.waitUntil(
    recordPreCheckoutAudit(context, contactId, body, ip, userAgent, booking),
  );

  // Append contact identifiers to the payment link so GHL associates the
  // resulting order with the right contact. The order webhook also uses
  // email-matching as a fallback if the URL params get stripped.
  const paymentUrl = new URL(booking.paymentLinkUrl);
  paymentUrl.searchParams.set("contact_id", contactId);
  paymentUrl.searchParams.set("email", body.email);
  paymentUrl.searchParams.set("first_name", body.firstName);
  paymentUrl.searchParams.set("last_name", body.lastName);
  paymentUrl.searchParams.set("phone", body.phone);

  return json(
    { checkoutUrl: paymentUrl.toString(), contactId },
    200,
    origin,
  );
}
