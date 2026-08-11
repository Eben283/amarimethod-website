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

import { ghlFetch, getGhlToken } from "../../lib/ghl.js";
import { appointmentEndTime } from "../../lib/datetime.js";
import { FIELD_IDS } from "../../lib/ghl-fields.js";
import { recordOpsError } from "../../lib/ops-alert.js";
import { recordAssessmentCheckout } from "../../lib/ops-assessment.js";
import { emitPathHop } from "../../lib/ops-path-emit.js";
import { assertSlotRespectsAppBuffer } from "../../lib/app-owned-buffer.js";
import { createConfirmedAppointment } from "../../lib/ghl-appointment-handoff.js";
import { createPaidBookingIntent } from "../../lib/paid-booking-intents.js";

const ALLOWED_ORIGINS = new Set([
  "https://www.amarimethod.com",
  "https://amarimethod.com",
]);
const DEFAULT_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Booking configuration. Each entry maps a sessionType (from the booking
// page) to the GHL payment link URL the customer should be redirected to
// after we've prepped the contact + stored the slot info on them.
//
// productId references GHL Products (see lib/ghl-products.js) so the
// purchase webhook can recognize this payment and create the appointment.
export const ALLOWED_BOOKINGS = {
  // Public first visit. This uses the native Amari calendar interface, then
  // hands payment to the existing GHL payment link. The purchase webhook
  // creates the selected Assessment appointment after payment, without
  // changing a prepaid-session balance or portal access.
  amari_assessment: {
    calendarId: "EM6vB2mq7EAdGCbUb3j1",
    productId: "6a66cf0103821ea09ea13f1b",
    price: 29,
    title: "Amari Assessment — In Person",
    durationMinutes: 50,
    pmaTag: "agreed-pma-v2026-06-16",
    requiresParticipantAgreement: true,
    participantAgreementVersion: "participant-agreement-v2026-08-09",
    sessionTag: null,
    paymentLinkUrl:
      "https://link.amarimethod.com/payment-link/6a66cf107b99151a540409b3",
  },
  // Future Google-Meet variant of the public Assessment. Its calendar is
  // deliberately inactive and this server-side gate rejects every checkout
  // request, so an unlinked URL or direct API call cannot create a payment
  // intent before its separate release proof.
  amari_assessment_virtual: {
    enabled: false,
    calendarId: "fFdlRts2KpUf2LYvPf2n",
    productId: "6a66cf0103821ea09ea13f1b",
    price: 29,
    title: "Amari Assessment — Virtual",
    durationMinutes: 50,
    pmaTag: "agreed-pma-v2026-06-16",
    requiresParticipantAgreement: true,
    participantAgreementVersion: "participant-agreement-v2026-08-09",
    sessionTag: null,
    paymentLinkUrl:
      "https://link.amarimethod.com/payment-link/6a66cf107b99151a540409b3",
  },
  // Free 15-min phone call. No Stripe payment link — we book the GHL
  // appointment directly in this handler and redirect to /book/success.
  discovery_call: {
    calendarId: "USgPsktqRcuomdUgpShL",
    productId: null,
    price: 0,
    title: "Amari Method Discovery Call",
    durationMinutes: 15,
    pmaTag: null,
    sessionTag: "booked-discovery-call",
    paymentLinkUrl: null,
    isFreeBooking: true,
    requiresPolicy: false,
  },
  discovery_virtual: {
    calendarId: "ZEIGFHBi17SpZ3Ezi5DR",
    productId: null,
    price: 0,
    title: "Amari Method Discovery Call — Virtual",
    durationMinutes: 15,
    pmaTag: null,
    sessionTag: "booked-discovery-call",
    paymentLinkUrl: null,
    isFreeBooking: true,
    requiresPolicy: false,
  },
  ambassador_discovery: {
    calendarId: "aVE54Qf4lrbYTB0zFqXy",
    productId: null,
    price: 0,
    title: "Amari Method Partnership Discovery Call",
    durationMinutes: 15,
    pmaTag: null,
    sessionTag: "booked-discovery-call",
    paymentLinkUrl: null,
    isFreeBooking: true,
    requiresPolicy: false,
  },
  partner_initial_in_person: {
    calendarId: "lfsnaiGiLNL2z12pLKDP",
    productId: null,
    price: 0,
    title: "Amari Method Partner Initial Session — In Person",
    durationMinutes: 60,
    pmaTag: "agreed-pma-v2026-04-17",
    sessionTag: null,
    paymentLinkUrl: null,
    isFreeBooking: true,
    requiresPolicy: true,
  },
  partner_initial_virtual: {
    calendarId: "P7T6M1w8wtuRfwAqzOVw",
    productId: null,
    price: 0,
    title: "Amari Method Partner Initial Session — Virtual",
    durationMinutes: 60,
    pmaTag: "agreed-pma-v2026-04-17",
    sessionTag: null,
    paymentLinkUrl: null,
    isFreeBooking: true,
    requiresPolicy: true,
  },
};

function corsHeaders(requestOrigin) {
  const allow = ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : "https://www.amarimethod.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

/** YYYY-MM-DD for GHL DATE fields — full ISO values can be rejected intermittently. */
export function slotDateOnly(startTime) {
  const m = String(startTime || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

export function looksLikeDuplicateContactError(status, errText) {
  if (status !== 400 && status !== 422) return false;
  return /duplicate|already exists|contact already|email.*exist/i.test(
    String(errText || ""),
  );
}

function contactIdFromLookup(data) {
  return (
    data?.contact?.id ||
    (Array.isArray(data?.contacts) && data.contacts[0]?.id) ||
    null
  );
}

/**
 * Resolve an existing contact id by email. Prefer /search/duplicate; fall back
 * to POST /contacts/search when duplicate lookup is non-ok or empty — the
 * historical "couldn't start the secure payment" path was create-after-missed-
 * lookup against an email that already existed.
 */
export async function findContactIdByEmail(context, locationId, email) {
  const lookupUrl = `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(email)}`;
  try {
    const lookupRes = await ghlFetch(context, lookupUrl);
    if (lookupRes.ok) {
      const id = contactIdFromLookup(await lookupRes.json());
      if (id) return id;
    } else {
      const errText = await lookupRes.text();
      console.error(
        `[book/create-checkout] contact lookup ${lookupRes.status}: ${errText}`,
      );
    }
  } catch (err) {
    console.error("[book/create-checkout] contact lookup failed:", err);
  }

  try {
    const searchRes = await ghlFetch(
      context,
      "https://services.leadconnectorhq.com/contacts/search",
      {
        method: "POST",
        body: JSON.stringify({
          locationId,
          pageLimit: 1,
          filters: [{ field: "email", operator: "eq", value: email }],
        }),
      },
    );
    if (searchRes.ok) {
      return contactIdFromLookup(await searchRes.json());
    }
    const errText = await searchRes.text();
    console.error(
      `[book/create-checkout] contact search ${searchRes.status}: ${errText}`,
    );
  } catch (err) {
    console.error("[book/create-checkout] contact search failed:", err);
  }
  return null;
}

export function buildSlotCustomFields(payload, booking) {
  const fields = [];
  if (!booking.isFreeBooking) {
    const dateOnly = slotDateOnly(payload.startTime);
    // Write by field id (contact GET returns {id,value} only; key writes are
    // flakier on GHL). DATE field gets YYYY-MM-DD; TEXT iso keeps the full slot.
    fields.push(
      {
        id: FIELD_IDS.requested_session_slot,
        field_value: dateOnly || payload.startTime,
      },
      {
        id: FIELD_IDS.requested_session_slot_iso,
        field_value: payload.startTime,
      },
      {
        id: FIELD_IDS.requested_session_calendar,
        field_value: booking.calendarId,
      },
      {
        id: FIELD_IDS.requested_session_type,
        field_value: payload.sessionType,
      },
    );
  }
  if (payload.agreeCommunications) {
    fields.push({
      key: "communications_policies_new_client",
      field_value: "true",
    });
  }
  return fields;
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

export function validateBody(b) {
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
  if (!ALLOWED_BOOKINGS[b.sessionType]) return "Invalid sessionType";
  const booking = ALLOWED_BOOKINGS[b.sessionType];
  if (booking.enabled === false) return "This booking is not yet available";
  if (booking.calendarId !== b.calendarId) {
    return "Calendar does not match sessionType";
  }
  // Paid bookings and complimentary partner sessions require the policy.
  // Short discovery calls remain free of that gate.
  // agreeCommunications is always optional.
  if ((!booking.isFreeBooking || booking.requiresPolicy) && !b.agreePolicies) {
    return "Missed Appointment Policy must be agreed to";
  }
  if (booking.requiresParticipantAgreement) {
    if (b.agreeParticipantAgreement !== true) {
      return "Participant Agreement must be agreed to";
    }
    if (b.participantAgreementVersion !== booking.participantAgreementVersion) {
      return "Current Participant Agreement must be agreed to";
    }
  }
  if (!booking.isFreeBooking && (
    typeof b.idempotencyKey !== "string" ||
    b.idempotencyKey.length < 8 ||
    b.idempotencyKey.length > 200
  )) {
    return "A valid idempotencyKey is required";
  }
  return null;
}

/**
 * Find existing contact by email or create a new one. Returns the contactId.
 * Sets the slot-request custom fields + communications consent in the same
 * PUT/POST so the GHL purchase webhook has everything it needs once the
 * order lands.
 */
export async function upsertContact(context, GHL_API_KEY, locationId, payload, booking) {
  let existingId = await findContactIdByEmail(context, locationId, payload.email);
  const customFields = buildSlotCustomFields(payload, booking);

  async function updateExisting(contactId) {
    const updateRes = await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
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
      // H1: for a PAID booking the requested_session_* slot fields written by
      // this PUT are what the purchase webhook reads to book the appointment
      // after payment. If the PUT failed, those fields aren't set — proceeding
      // would charge the customer and book nothing, with no alert. Abort so the
      // caller returns 422 and the customer is never charged for an un-bookable
      // slot. Free bookings carry no slot fields (the appointment is booked
      // directly in this handler) so a PUT failure there stays best-effort.
      if (!booking.isFreeBooking) {
        throw new Error(`GHL contact update failed (${updateRes.status}): ${errText}`);
      }
    }
    return contactId;
  }

  if (existingId) {
    return updateExisting(existingId);
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
    // Duplicate-create race: lookup missed an existing contact (or a parallel
    // request won). Recover by looking up again and updating — otherwise the
    // browser shows "couldn't start the secure payment" with no recovery.
    if (looksLikeDuplicateContactError(createRes.status, errText)) {
      console.error(
        `[book/create-checkout] create hit duplicate (${createRes.status}); recovering via re-lookup`,
      );
      existingId = await findContactIdByEmail(context, locationId, payload.email);
      if (existingId) return updateExisting(existingId);
    }
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
  // Build tag list. pmaTag is null for discovery calls and set for partner
  // sessions. sessionTag is set on both paid + free where lifecycle routing
  // what they booked. native-booking-started flags the contact as having
  // moved through the new flow vs the old GHL funnel iframe.
  const tags = ["native-booking-started"];
  if (booking.pmaTag) tags.push(booking.pmaTag);
  if (booking.sessionTag) tags.push(booking.sessionTag);

  try {
    await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      {
        method: "POST",
        body: JSON.stringify({ tags }),
      },
    );
  } catch (err) {
    console.error("[book/create-checkout] tag add failed:", err);
  }

  const isFree = !!booking.isFreeBooking;
  const noteBody = [
    isFree
      ? `Native booking flow — free appointment booked directly`
      : `Native booking flow — checkout initiated`,
    ``,
    `Session: ${booking.title}`,
    `Requested slot: ${payload.startTime} (${payload.timezone})`,
    isFree
      ? `Free booking: no payment${booking.requiresPolicy ? "; policy accepted" : " or policy gate"}`
      : `Agreement version: ${payload.agreementVersion || "unspecified"}`,
    `Communications consent: ${payload.agreeCommunications ? "yes" : "no (optional, declined)"}`,
    ...(!booking.requiresPolicy && isFree
      ? []
      : [
          `Missed Appointment Policy: yes (clickwrap)`,
        ]),
    ...(booking.requiresParticipantAgreement
      ? [
          `Participant Agreement: yes (clickwrap; version ${payload.participantAgreementVersion})`,
        ]
      : []),
    `IP: ${ip || "unknown"}`,
    `User agent: ${(ua || "").slice(0, 200)}`,
    `Captured at: ${new Date().toISOString()}`,
    ``,
    isFree
      ? `Appointment booked directly via /calendars/events/appointments. No payment step.`
      : `Next: customer redirected to GHL payment link. Appointment will be booked automatically when the order is paid.`,
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

/**
 * Book a free appointment directly via GHL Calendar API. Used for the
 * discovery call flow (no Stripe step). Availability is verified again here
 * immediately before the write so an abandoned browser tab cannot consume a
 * protected turnover window after another appointment has been made.
 *
 * Returns the appointment id on success. Throws on failure so the caller
 * can return a 422 to the browser instead of redirecting to a confirm
 * page that has nothing on the calendar.
 */
async function bookFreeAppointment(context, locationId, contactId, payload, booking) {
  // GHL requires startTime/endTime to keep their timezone offset
  // (e.g. "2026-05-21T10:00:00-07:00"); stripping it makes GHL reject the slot
  // as "not available". appointmentEndTime preserves both the instant and the
  // offset (see functions/lib/datetime.js).
  const endTime = appointmentEndTime(payload.startTime, booking.durationMinutes);
  await assertSlotRespectsAppBuffer(context, payload.startTime, booking.calendarId);

  const data = await createConfirmedAppointment({
    endpoint: "https://services.leadconnectorhq.com/calendars/events/appointments",
    request: (url, options) => ghlFetch(context, url, options),
    payload: {
      calendarId: booking.calendarId,
      locationId,
      contactId,
      startTime: payload.startTime,
      endTime,
      selectedTimezone: payload.timezone,
      title: `${booking.title} - ${payload.firstName} ${payload.lastName}`,
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone,
      ignoreDateRange: false,
      toNotify: true,
    },
  });
  return data?.id || data?.appointment?.id || null;
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

  // First availability check: prevents starting a payment flow for a slot
  // that already conflicts with an app-owned session turnover window. Paid
  // bookings are checked a second time by ghl-purchase-webhook at handoff.
  try {
    await assertSlotRespectsAppBuffer(context, body.startTime, booking.calendarId);
  } catch {
    return json({ error: "That time is no longer available. Please choose another." }, 422, origin);
  }

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
    const errSource =
      body.sessionType === "discovery_call"
        ? "book/create-checkout:discovery"
        : body.sessionType === "amari_assessment"
          ? "book/create-checkout:assessment"
          : "book/create-checkout";
    context.waitUntil(
      recordOpsError(env, errSource, "contact upsert failed", {
        sessionType: body.sessionType,
        calendarId: body.calendarId,
        message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      }),
    );
    return json(
      {
        error: "Could not save your details. Please try again.",
        code: "contact_upsert_failed",
      },
      422,
      origin,
    );
  }

  // Persist the immutable payment-to-slot intent before the browser leaves
  // Amari for GHL checkout. The order webhook binds only an unambiguous D1
  // intent; mutable contact custom fields remain a legacy fallback, not the
  // source of truth for newly issued paid checkouts.
  if (!booking.isFreeBooking) {
    try {
      const participantAgreementAcceptedAt = booking.requiresParticipantAgreement
        ? Date.now()
        : null;
      const intent = await createPaidBookingIntent(env.ATTEND_DB, {
        intentId: body.idempotencyKey,
        contactId,
        productId: booking.productId,
        calendarId: booking.calendarId,
        startTime: body.startTime,
        timezone: body.timezone,
        participantAgreementVersion: booking.requiresParticipantAgreement
          ? body.participantAgreementVersion
          : null,
        participantAgreementAcceptedAt,
        participantAgreementIp: booking.requiresParticipantAgreement ? ip : null,
        participantAgreementUserAgent: booking.requiresParticipantAgreement ? userAgent.slice(0, 200) : null,
      });
      if (intent.state === "conflict") {
        return json({ error: "This checkout key was already used for a different booking." }, 409, origin);
      }
    } catch (err) {
      console.error("[book/create-checkout] durable intent failed:", err);
      context.waitUntil(recordOpsError(env, "book/create-checkout", "paid booking intent was not saved", {
        contactId,
        sessionType: body.sessionType,
        message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      }));
      return json({ error: "Secure payment is temporarily unavailable. Please try again.", retryable: true }, 503, origin);
    }
  }

  // Tags + audit note in parallel — neither blocks the redirect.
  context.waitUntil(
    recordPreCheckoutAudit(context, contactId, body, ip, userAgent, booking),
  );

  const personLabel = [body.firstName, body.lastName].filter(Boolean).join(" ").trim() || null;

  // Amari Ops: Assessment checkout hop (path assessment_paid_book).
  if (body.sessionType === "amari_assessment") {
    context.waitUntil(
      recordAssessmentCheckout(env, {
        contactId,
        personLabel,
        startTime: body.startTime,
        sessionType: body.sessionType,
      }),
    );
  }

  // ----- Free booking flow (discovery call) -----
  // Book the appointment directly + redirect straight to the success
  // page. No Stripe payment link, no purchase webhook handoff.
  if (booking.isFreeBooking) {
    context.waitUntil(
      emitPathHop(env, {
        pathId: "discovery_free_book",
        hopId: "submit",
        outcome: "ok",
        summary: "Discovery submit + contact upserted",
        source: "book/create-checkout:discovery",
        contactId,
        personLabel,
        correlationId: contactId && body.startTime ? `discovery:${contactId}:${body.startTime}` : null,
        trigger: { type: "book.create_checkout", id: body.sessionType },
      }),
    );
    try {
      await bookFreeAppointment(context, locationId, contactId, body, booking);
      context.waitUntil(
        emitPathHop(env, {
          pathId: "discovery_free_book",
          hopId: "create_appointment",
          outcome: "ok",
          summary: "Discovery call booked",
          source: "book/create-checkout:discovery",
          contactId,
          personLabel,
          correlationId: contactId && body.startTime ? `discovery:${contactId}:${body.startTime}` : null,
          condition: {
            expected: "free discovery appointment created",
            observed: body.startTime ? String(body.startTime) : "null",
          },
        }),
      );
    } catch (err) {
      console.error("[book/create-checkout] free appointment book failed:", err);
      context.waitUntil(
        recordOpsError(env, "book/create-checkout:discovery", "free appointment book failed", {
          sessionType: body.sessionType,
          contactId,
          message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        }),
      );
      context.waitUntil(
        emitPathHop(env, {
          pathId: "discovery_free_book",
          hopId: "create_appointment",
          outcome: "fail",
          summary: "Discovery call failed to book",
          source: "book/create-checkout:discovery",
          contactId,
          personLabel,
          reasonCode: "book_failed",
          condition: {
            expected: "free discovery appointment created",
            observed: err instanceof Error ? err.message.slice(0, 120) : "error",
          },
        }),
      );
      return json(
        { error: "Could not book your call. Please try a different time or email eben@amarimethod.com." },
        422,
        origin,
      );
    }
    const successUrl = new URL("https://www.amarimethod.com/book/success");
    successUrl.searchParams.set("product", body.sessionType);
    successUrl.searchParams.set("slot", body.startTime);
    return json(
      { checkoutUrl: successUrl.toString(), contactId },
      200,
      origin,
    );
  }

  // ----- Paid booking flow (initial sessions) -----
  // Append contact identifiers to the payment link so GHL associates the
  // resulting order with the right contact. The order webhook also uses
  // email-matching as a fallback if the URL params get stripped.
  const paymentUrl = new URL(booking.paymentLinkUrl);
  paymentUrl.searchParams.set("contact_id", contactId);
  paymentUrl.searchParams.set("email", body.email);
  paymentUrl.searchParams.set("first_name", body.firstName);
  paymentUrl.searchParams.set("last_name", body.lastName);
  paymentUrl.searchParams.set("phone", body.phone);
  // Diagnostic correlation only. The webhook does not trust GHL to echo this
  // parameter; it binds against the server-side D1 intent.
  paymentUrl.searchParams.set("amari_intent", body.idempotencyKey);

  return json(
    { checkoutUrl: paymentUrl.toString(), contactId },
    200,
    origin,
  );
}
