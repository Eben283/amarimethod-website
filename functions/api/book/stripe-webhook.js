/**
 * POST /api/book/stripe-webhook
 *
 * Stripe webhook handler for the native booking flow. Listens for
 * `checkout.session.completed` and creates the GHL appointment based on
 * the metadata that create-checkout.js stamped onto the session.
 *
 * Required env vars:
 *   STRIPE_WEBHOOK_SECRET — the signing secret from the Stripe webhook
 *                           endpoint config (starts with `whsec_`).
 *   GHL_LOCATION_ID       — defaults to 7pIO7FHVAyBT1jKGhfQM if absent.
 *   PORTAL_KV             — KV binding (already present, used for OAuth
 *                           tokens) — also used here for idempotency.
 *
 * Stripe webhook config:
 *   URL:    https://www.amarimethod.com/api/book/stripe-webhook
 *   Events: checkout.session.completed
 *           checkout.session.expired (logged only, no action)
 */

import { ghlFetch } from "../../lib/ghl.js";

const KV_TTL_SECONDS = 14 * 86400; // 14 days — Stripe retries within 3 days

function txt(msg, status = 200) {
  return new Response(msg, { status, headers: { "Content-Type": "text/plain" } });
}

/**
 * Verify a Stripe webhook signature. Stripe sends:
 *   Stripe-Signature: t=<unix_ts>,v1=<sig1>,v1=<sig2>,...,v0=<sig0>
 *
 * The signed payload is `${t}.${rawBody}` and `v1` is HMAC-SHA256 of that
 * with the webhook secret. We accept any v1 sig that matches.
 */
async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;

  const parts = Object.create(null);
  for (const segment of signatureHeader.split(",")) {
    const [key, val] = segment.split("=");
    if (!key || !val) continue;
    if (key === "v1") {
      parts.v1 = parts.v1 || [];
      parts.v1.push(val);
    } else {
      parts[key] = val;
    }
  }
  if (!parts.t || !parts.v1) return false;

  const ts = parseInt(parts.t, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${parts.t}.${rawBody}`),
  );
  const expectedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare against any of the v1 sigs
  for (const candidate of parts.v1) {
    if (candidate.length !== expectedHex.length) continue;
    let mismatch = 0;
    for (let i = 0; i < expectedHex.length; i++) {
      mismatch |= candidate.charCodeAt(i) ^ expectedHex.charCodeAt(i);
    }
    if (mismatch === 0) return true;
  }
  return false;
}

/**
 * Compute endTime by adding durationMinutes to startTime, preserving the
 * timezone offset suffix (GHL rejects appointments where the offset is
 * stripped). Mirrors the offset-preservation logic in portal-book.js.
 */
function computeEndTime(startTime, durationMinutes) {
  const offsetMatch = startTime.match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = offsetMatch ? offsetMatch[1] : "Z";
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid startTime: ${startTime}`);
  }
  const endMs = startMs + durationMinutes * 60 * 1000;
  const endIso = new Date(endMs).toISOString().replace("Z", offset === "Z" ? "Z" : offset);
  return endIso;
}

async function createAppointment(context, meta) {
  const payload = {
    calendarId: meta.calendarId,
    locationId: meta.locationId,
    contactId: meta.contactId,
    startTime: meta.startTime,
    endTime: computeEndTime(meta.startTime, parseInt(meta.durationMinutes, 10) || 60),
    selectedTimezone: meta.timezone,
    title: meta.sessionTitle,
    appointmentStatus: "confirmed",
    firstName: meta.firstName,
    lastName: meta.lastName,
    email: meta.email,
    phone: meta.phone,
  };

  const res = await ghlFetch(
    context,
    "https://services.leadconnectorhq.com/calendars/events/appointments",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL appointment create ${res.status}: ${errText}`);
  }
  return res.json();
}

/**
 * Record the Stripe payment as a GHL /payments/orders row so it shows up in
 * the GHL Payments dashboard, the staff session-ledger (lib/session-ledger.js
 * classifyOrder), and any downstream "Order Submitted" workflow triggers.
 *
 * Without this, native-checkout payments are invisible to the staff
 * dashboard's Today/Balances tabs and to the /day daily briefing.
 *
 * sourceType is set to "payment_link" because that's what the existing
 * session-ledger logic treats as a real purchase (sourceType="calendar"
 * is reserved for booking-generated $0 placeholders).
 */
async function recordGhlOrder(context, meta, session) {
  const amountTotal = (session.amount_total || 0) / 100;
  const orderPayload = {
    altId: meta.locationId,
    altType: "location",
    contactId: meta.contactId,
    currency: (session.currency || "usd").toUpperCase(),
    totalAmount: amountTotal,
    amount: amountTotal,
    status: "completed",
    sourceType: "payment_link",
    sourceName: meta.sessionTitle,
    sourceSubType: "native_checkout",
    sourceMeta: {
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent || null,
      source: "native_booking_flow",
    },
    items: [
      {
        productId: meta.productId,
        name: meta.sessionTitle,
        qty: 1,
        amount: amountTotal,
        currency: (session.currency || "usd").toUpperCase(),
      },
    ],
  };

  const res = await ghlFetch(
    context,
    "https://services.leadconnectorhq.com/payments/orders",
    {
      method: "POST",
      body: JSON.stringify(orderPayload),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL order create ${res.status}: ${errText}`);
  }
  return res.json();
}

async function applyTags(context, contactId, tags) {
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
    console.error("[book/stripe-webhook] tag apply failed:", err);
  }
}

async function noteOnContact(context, contactId, body) {
  try {
    await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  } catch (err) {
    console.error("[book/stripe-webhook] note add failed:", err);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("[book/stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return txt("webhook not configured", 500);
  }

  const sigHeader = request.headers.get("Stripe-Signature");
  const rawBody = await request.text();

  const valid = await verifyStripeSignature(
    rawBody,
    sigHeader,
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!valid) {
    console.warn("[book/stripe-webhook] signature verification failed");
    return txt("invalid signature", 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return txt("invalid json", 400);
  }

  // Idempotency — Stripe retries on 5xx / network errors, and we don't
  // want to double-book if the same event lands twice.
  const kv = env.PORTAL_KV;
  if (kv && event.id) {
    const seen = await kv.get(`stripe_evt:${event.id}`);
    if (seen) return txt("already processed", 200);
  }

  if (event.type === "checkout.session.expired") {
    // Slot held but never paid — nothing to do, GHL slot frees up automatically
    if (kv && event.id) {
      await kv.put(`stripe_evt:${event.id}`, "1", { expirationTtl: KV_TTL_SECONDS });
    }
    return txt("ok (expired)", 200);
  }

  if (event.type !== "checkout.session.completed") {
    // Other event types we subscribed to but don't act on
    return txt("ok (no-op)", 200);
  }

  const session = event.data?.object || {};
  const meta = session.metadata || {};

  const required = [
    "contactId",
    "locationId",
    "calendarId",
    "productId",
    "sessionType",
    "sessionTitle",
    "durationMinutes",
    "startTime",
    "timezone",
    "firstName",
    "lastName",
    "email",
    "phone",
  ];
  for (const k of required) {
    if (!meta[k]) {
      console.error(
        `[book/stripe-webhook] missing metadata ${k} for session ${session.id}`,
      );
      return txt(`missing metadata ${k}`, 200); // 200 so Stripe doesn't retry
    }
  }

  let appointment;
  try {
    appointment = await createAppointment(context, meta);
  } catch (err) {
    console.error(
      `[book/stripe-webhook] appointment create failed for session ${session.id}:`,
      err.message,
    );
    // Don't 200 here — return 5xx so Stripe retries. If the slot is taken
    // we'll need to refund manually; logging surfaces the issue.
    await noteOnContact(
      context,
      meta.contactId,
      `URGENT: Stripe payment received (session ${session.id}, $${(session.amount_total || 0) / 100}) but GHL appointment creation FAILED. ` +
        `Slot: ${meta.startTime} (${meta.timezone}). Calendar: ${meta.calendarId}. ` +
        `Error: ${err.message}. ` +
        `Action: manually book the slot or refund the payment.`,
    );
    return txt("appointment create failed", 500);
  }

  // Record the GHL order so the staff dashboard, daily briefing, GHL Payments
  // tab, and any "Order Submitted" workflow triggers all see this purchase.
  // Best-effort — failure here means GHL Payments tab won't show it but the
  // appointment is still booked, so we surface via URGENT note for manual
  // reconciliation rather than failing the whole webhook (which would cause
  // Stripe to retry and risk a double appointment).
  let orderResult = null;
  let orderError = null;
  try {
    orderResult = await recordGhlOrder(context, meta, session);
  } catch (err) {
    orderError = err.message;
    console.error(
      `[book/stripe-webhook] GHL order record failed for session ${session.id}:`,
      err.message,
    );
    await noteOnContact(
      context,
      meta.contactId,
      `RECONCILE NEEDED: appointment booked + Stripe payment received (session ${session.id}, $${(session.amount_total || 0) / 100}) ` +
        `but GHL /payments/orders POST failed. Staff dashboard and Payments tab will not show this purchase until it's reconciled. ` +
        `Error: ${err.message}`,
    );
  }

  // Tag the contact + add a confirmation note. Best-effort — appointment
  // is already on the calendar so these failures don't block.
  const tags = [meta.pmaTag, meta.sessionTag, "paid-via-native-checkout"]
    .filter(Boolean);
  await applyTags(context, meta.contactId, tags);

  await noteOnContact(
    context,
    meta.contactId,
    [
      `Booking confirmed via native checkout`,
      `Session: ${meta.sessionTitle}`,
      `Slot: ${meta.startTime} (${meta.timezone})`,
      `Stripe session: ${session.id}`,
      `Stripe payment intent: ${session.payment_intent || "—"}`,
      `Amount: $${(session.amount_total || 0) / 100}`,
      `Appointment id: ${appointment.id || appointment.appointment?.id || "—"}`,
      `GHL order id: ${orderResult?.id || orderResult?.order?.id || (orderError ? "FAILED — see RECONCILE note above" : "—")}`,
    ].join("\n"),
  );

  if (kv && event.id) {
    await kv.put(`stripe_evt:${event.id}`, "1", { expirationTtl: KV_TTL_SECONDS });
  }

  return txt("ok", 200);
}

// Stripe webhooks are unauthenticated POSTs — block any other method.
export async function onRequestGet() {
  return txt("method not allowed", 405);
}
