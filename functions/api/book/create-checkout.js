/**
 * POST /api/book/create-checkout
 *
 * Creates the GHL contact (or updates an existing one) with clickwrap
 * agreement metadata, then creates a Stripe Checkout session for the
 * session price. Returns { checkoutUrl } so the browser can redirect.
 *
 * The Stripe webhook (functions/api/book/stripe-webhook.js) is what
 * actually creates the GHL appointment after payment succeeds — this
 * endpoint only sets up the payment intent + holds the contact data.
 *
 * Requires env vars: STRIPE_SECRET_KEY (live), GHL_LOCATION_ID (defaults
 * to 7pIO7FHVAyBT1jKGhfQM if not set).
 */

import { ghlFetch, ghlHeaders, getGhlToken } from "../../lib/ghl.js";

const ALLOWED_ORIGIN = "https://www.amarimethod.com";
const DEFAULT_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Mirrors public-slots.js — same allowlist so this endpoint can't book
// arbitrary calendars. productId references GHL Products (see
// lib/ghl-products.js) so the Stripe webhook can record an /payments/orders
// row that classifies correctly in the staff dashboard's session ledger.
const ALLOWED_BOOKINGS = {
  initial_in_person: {
    calendarId: "G7OAnnJuFbMF6nQSlZVQ",
    productId: "688a1cd770362828afbf08a2", // GHL: "Initial Session — In Person"
    price: 225,
    title: "Amari Method Initial Session — In Person",
    durationMinutes: 60,
    pmaTag: "agreed-pma-v2026-04-17",
    sessionTag: "booked-initial-in-person",
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
  // agreeCommunications is OPTIONAL (marketing-comms opt-in) — only the
  // policies/PMA agreement is required for the booking to proceed.
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
 * Find existing contact by email or create a new one. Returns the
 * contactId. Updates basic fields (name, phone) on every call so a
 * returning client's record stays current.
 */
async function upsertContact(context, GHL_API_KEY, locationId, payload) {
  // GHL contact lookup by email
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

  // Only set communications_policies_new_client if the optional checkbox
  // was actually checked. Leaving it unset for non-opters keeps the
  // marketing-comms list clean.
  const customFields = payload.agreeCommunications
    ? [{ key: "communications_policies_new_client", field_value: "true" }]
    : [];

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
      // Non-fatal — we still have the contact, continue with checkout
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
 * Add the agreement-version + session tag and write the clickwrap
 * audit trail to a contact note. Failures here are logged but don't
 * block the checkout — the source of truth is Stripe metadata, which
 * the webhook re-applies on success.
 */
async function recordAgreementAudit(context, contactId, payload, ip, ua, booking) {
  // Tag the contact with the PMA version + the booking tag
  try {
    await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      {
        method: "POST",
        body: JSON.stringify({
          tags: [booking.pmaTag, booking.sessionTag],
        }),
      },
    );
  } catch (err) {
    console.error("[book/create-checkout] tag add failed:", err);
  }

  // Audit note — readable in GHL contact view + searchable
  const noteBody = [
    `Native booking flow — clickwrap agreement captured`,
    ``,
    `Session: ${booking.title}`,
    `Slot: ${payload.startTime} (${payload.timezone})`,
    `Agreement version: ${payload.agreementVersion || "unspecified"}`,
    `Communications consent: yes`,
    `Practice Member Agreement: yes (clickwrap)`,
    `Missed Appointment Policy: yes (clickwrap)`,
    `IP: ${ip || "unknown"}`,
    `User agent: ${(ua || "").slice(0, 200)}`,
    `Captured at: ${new Date().toISOString()}`,
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
 * Create a Stripe Checkout session via the v1 REST API. Cloudflare
 * Workers can't use the Node Stripe SDK, so we hit the form-encoded
 * endpoint directly.
 */
async function createStripeCheckout(secretKey, params) {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("customer_email", params.email);
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  form.set("payment_method_types[0]", "card");
  // Affirm requires USD + min $50 — we're $225, so it's eligible.
  form.set("payment_method_types[1]", "affirm");
  form.set("expires_at", String(params.expiresAt));

  // Single line item via inline price_data
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(params.unitAmount));
  form.set("line_items[0][price_data][product_data][name]", params.productName);
  form.set(
    "line_items[0][price_data][product_data][description]",
    params.productDescription,
  );

  // Metadata that the webhook reads to actually book the appointment.
  // Stripe enforces 50 keys, 500 chars/value — we're well under.
  for (const [k, v] of Object.entries(params.metadata)) {
    form.set(`metadata[${k}]`, String(v).slice(0, 500));
    form.set(`payment_intent_data[metadata][${k}]`, String(v).slice(0, 500));
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe checkout create ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";

  if (!env.STRIPE_SECRET_KEY) {
    console.error("[book/create-checkout] STRIPE_SECRET_KEY not configured");
    return json(
      { error: "Payment not configured. Email eben@amarimethod.com." },
      500,
      origin,
    );
  }

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
    contactId = await upsertContact(context, GHL_API_KEY, locationId, body);
  } catch (err) {
    console.error("[book/create-checkout] contact upsert failed:", err);
    return json(
      { error: "Could not save your details. Please try again." },
      422,
      origin,
    );
  }

  // Don't await this — the audit doesn't need to block redirect to Stripe.
  // The webhook re-applies the same tags on payment, so even if this
  // best-effort call fails the contact still ends up tagged correctly.
  context.waitUntil(
    recordAgreementAudit(context, contactId, body, ip, userAgent, booking),
  );

  const baseUrl = "https://www.amarimethod.com";
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60; // 30-min hold

  let session;
  try {
    session = await createStripeCheckout(env.STRIPE_SECRET_KEY, {
      email: body.email,
      successUrl: `${baseUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/book/initial-in-person/`,
      expiresAt,
      unitAmount: booking.price * 100,
      productName: booking.title,
      productDescription: `${booking.durationMinutes}-minute session with Dr. Garrett`,
      metadata: {
        contactId,
        locationId,
        calendarId: booking.calendarId,
        productId: booking.productId,
        sessionType: body.sessionType,
        sessionTitle: booking.title,
        durationMinutes: booking.durationMinutes,
        startTime: body.startTime,
        timezone: body.timezone,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        agreementVersion: body.agreementVersion || "",
        agreementIp: ip,
        agreedAt: new Date().toISOString(),
        pmaTag: booking.pmaTag,
        sessionTag: booking.sessionTag,
      },
    });
  } catch (err) {
    console.error("[book/create-checkout] Stripe session create failed:", err);
    return json(
      { error: "Could not start payment. Please try again." },
      422,
      origin,
    );
  }

  return json({ checkoutUrl: session.url, sessionId: session.id }, 200, origin);
}
