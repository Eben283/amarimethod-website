// Cloudflare Pages Function: POST /api/ghl-purchase-webhook
// Backup webhook — ensures sessions_remaining gets set on every purchase,
// even if GHL's internal purchase workflows fail to fire.
//
// Triggered by: GHL outbound webhook on "Order Submitted" event.
//
// Flow:
// 1. Verify webhook secret
// 2. Extract contact ID, product ID, order ID from payload
// 3. Map product ID to package (sessions to add, series type, etc.)
// 4. Idempotency check via Cloudflare KV (skip if already processed)
// 5. Read current sessions_remaining from GHL contact
// 6. Compute new value and PUT back to GHL
// 7. Store order ID in KV to prevent duplicates
//
// Setup (manual, post-deploy):
//   1. Add GHL_WEBHOOK_SECRET env var in Cloudflare Dashboard
//   2. Create PURCHASE_KV namespace in Cloudflare and bind to Pages project
//   3. In GHL → Settings → Webhooks → "Order Submitted" event →
//      URL: https://www.amarimethod.com/api/ghl-purchase-webhook
//      Header: X-Webhook-Secret: <same value as GHL_WEBHOOK_SECRET>

import { ghlFetch, ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { PURCHASE_CREDIT_MAP, productIdForAnyId } from "../lib/ghl-products.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// ── Product-to-package mapping ──
// Crediting now DERIVES from the single source of truth (functions/lib/
// ghl-products.js → PURCHASE_CREDIT_MAP). This file only overlays the two
// webhook-specific things the catalog doesn't carry:
//   1. booking metadata for the native-booking Initials (calendar, title, tag)
//   2. the RETIRED legacy follow-up (67f57171), kept so old orders still credit.
// Draw-down follow-ups (69aee204 / 69aee3eb / 67b1299f) are excluded by the
// catalog itself (DRAW_DOWN_PRODUCT_IDS) — crediting them would inflate balances.

const INITIAL_BOOKING_META = {
  "688a1cd770362828afbf08a2": {
    isInitialBooking: true,
    calendarId: "G7OAnnJuFbMF6nQSlZVQ",
    durationMinutes: 60,
    sessionTitle: "Amari Method Initial Session — In Person",
    sessionTag: "booked-initial-in-person",
    bookingSessionType: "initial_in_person",
  },
  "690b6b4d333ffa59d40c1823": {
    isInitialBooking: true,
    calendarId: "ySmht5hx4uZGEpgZrlCw",
    durationMinutes: 60,
    sessionTitle: "Amari Method Initial Session — Virtual",
    sessionTag: "booked-initial-virtual",
    bookingSessionType: "initial_virtual",
  },
};

// The paid Assessment needs an appointment after purchase but must never
// change a session balance or unlock the client portal. It deliberately lives
// outside PURCHASE_CREDIT_MAP, which contains purchases that add practice
// sessions.
const ASSESSMENT_BOOKING_META = {
  "6a66cf0103821ea09ea13f1b": {
    name: "Amari Assessment",
    sessionsToAdd: 0,
    seriesType: null,
    livingPractice: false,
    isAssessmentBooking: true,
    calendarId: "EM6vB2mq7EAdGCbUb3j1",
    durationMinutes: 40,
    sessionTitle: "Amari Assessment — In Person",
    sessionTag: "booked-amari-assessment",
    bookingSessionType: "amari_assessment",
  },
};

const LEGACY_CREDITS = {
  // Retired "Amari Method: Follow-Up Sessions" — no longer sold; kept so any
  // historical order still credits +1. Not in the catalog (it classifies retired).
  "67f57171b6b1019c7b0233cc": { name: "Single Follow-up", sessionsToAdd: 1, seriesType: null, livingPractice: false },
};

export const PRODUCT_MAP = (() => {
  const m = { ...LEGACY_CREDITS, ...ASSESSMENT_BOOKING_META };
  for (const [id, entry] of Object.entries(PURCHASE_CREDIT_MAP)) {
    m[id] = INITIAL_BOOKING_META[id] ? { ...entry, ...INITIAL_BOOKING_META[id] } : { ...entry };
  }
  return m;
})();

// Field keys for the slot-request fields written by create-checkout.js
// (Settings → Custom Fields → Session Tracking folder)
const REQUESTED_SLOT_FIELD_KEYS = [
  "requested_session_slot",
  "requested_session_calendar",
  "requested_session_type",
];

/**
 * Read a custom field value from a GHL contact object by FIELD KEY
 * (not ID). The contact's customFields array entries may have `fieldKey`
 * or `key` depending on the API version that returned them.
 */
function getCustomFieldValueByKey(contact, fieldKey) {
  if (!contact.customFields) return null;
  const field = contact.customFields.find(
    (f) => f.fieldKey === fieldKey || f.key === fieldKey ||
           // Some payloads return the key as "contact.<key>"
           f.fieldKey === `contact.${fieldKey}` || f.key === `contact.${fieldKey}`,
  );
  return field ? (field.value ?? field.field_value ?? null) : null;
}

/**
 * Book the appointment that the user picked during native-flow checkout.
 * Reads requested_session_slot off the contact; if missing, this purchase
 * came from an old-style GHL funnel (which booked the appointment itself)
 * so we skip and return null without erroring.
 */
async function bookPaidBookingAppointment(context, contact, pkg, token) {
  const slot = getCustomFieldValueByKey(contact, "requested_session_slot");
  if (!slot) {
    console.log(
      `[ghl-purchase-webhook] No requested_session_slot on contact ${contact.id} — assuming legacy funnel purchase, skipping appointment creation`,
    );
    return null;
  }

  const requestedCalendar = getCustomFieldValueByKey(contact, "requested_session_calendar");
  const requestedType = getCustomFieldValueByKey(contact, "requested_session_type");
  if (
    requestedCalendar !== pkg.calendarId ||
    requestedType !== pkg.bookingSessionType
  ) {
    console.warn(
      `[ghl-purchase-webhook] Requested booking metadata does not match ${pkg.name}; skipping auto-book to avoid using a stale slot`,
    );
    return null;
  }
  // Guard against duplicate-booking: if the contact already has an upcoming
  // appointment on this booking's calendar, skip the auto-book. requested_session_slot
  // can be stale from an abandoned website booking flow, which would
  // otherwise cause a second appointment for a slot the customer never picked.
  try {
    const apptRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${contact.id}/appointments`,
    );
    if (apptRes.ok) {
      const apptData = await apptRes.json();
      const appointments = apptData.events || apptData.appointments || [];
      const now = Date.now();
      const existing = appointments.find((a) => {
        if (a.calendarId !== pkg.calendarId) return false;
        const startMs = new Date(a.startTime).getTime();
        if (!Number.isFinite(startMs) || startMs < now) return false;
        const status = (a.appointmentStatus || "").toLowerCase();
        if (status === "cancelled" || status === "noshow") return false;
        return true;
      });
      if (existing) {
        console.log(
          `[ghl-purchase-webhook] Contact ${contact.id} already has upcoming booking (${existing.id} at ${existing.startTime}) — skipping auto-book to avoid duplicate`,
        );
        return existing;
      }
    }
  } catch (err) {
    // Guard failure is non-fatal — fall through to the original auto-book.
    console.warn(
      `[ghl-purchase-webhook] Duplicate-appointment check failed: ${err.message} — proceeding with auto-book`,
    );
  }

  // Compute endTime by adding duration to start. Preserve any timezone
  // offset suffix on the slot (GHL rejects appointments where the offset
  // is stripped — mirrors the logic in functions/api/portal-book.js).
  const offsetMatch = slot.match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = offsetMatch ? offsetMatch[1] : "Z";
  const startMs = new Date(slot).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid requested_session_slot: ${slot}`);
  }
  const endMs = startMs + pkg.durationMinutes * 60 * 1000;
  const endTime = new Date(endMs)
    .toISOString()
    .replace("Z", offset === "Z" ? "Z" : offset);

  const payload = {
    calendarId: pkg.calendarId,
    locationId: LOCATION_ID,
    contactId: contact.id,
    startTime: slot,
    endTime,
    selectedTimezone: "America/Los_Angeles", // safe default; appointment's local TZ
    title: pkg.sessionTitle,
    appointmentStatus: "confirmed",
    firstName: contact.firstName || "",
    lastName: contact.lastName || "",
    email: contact.email || "",
    phone: contact.phone || "",
  };

  const res = await fetch(
    `${GHL_API_BASE}/calendars/events/appointments`,
    {
      method: "POST",
      headers: ghlHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Appointment create failed (${res.status}): ${errText.slice(0, 500)}`,
    );
  }

  const data = await res.json();
  console.log(
    `[ghl-purchase-webhook] Booked ${pkg.name} appointment for ${contact.id} at ${slot} (apptId: ${data.id || data.appointment?.id})`,
  );

  return data;
}

/**
 * After booking, apply tags + write a confirmation note. Best-effort —
 * non-fatal if any fail.
 */
async function recordPaidBooking(context, contactId, pkg, appointment) {
  try {
    await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${contactId}/tags`,
      {
        method: "POST",
        body: JSON.stringify({
          tags: [pkg.sessionTag, "paid-via-native-checkout"],
        }),
      },
    );
  } catch (err) {
    console.error("[ghl-purchase-webhook] tag apply failed:", err);
  }

  const apptId = appointment?.id || appointment?.appointment?.id || "—";
  try {
    await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${contactId}/notes`,
      {
        method: "POST",
        body: JSON.stringify({
          body: [
            `Native booking payment received — appointment booked`,
            ``,
            `Session: ${pkg.name}`,
            `Appointment id: ${apptId}`,
            `Calendar: ${pkg.calendarId}`,
            `Card saved on this contact's GHL Payment Methods (visible in`,
            `the contact's Payments panel — chargeable for future purchases).`,
          ].join("\n"),
        }),
      },
    );
  } catch (err) {
    console.error("[ghl-purchase-webhook] note add failed:", err);
  }
}

// ── GHL custom field IDs ──
const FIELD_IDS = {
  sessionsRemaining: "wrQSkx6BhXwDGIn1d0V4",
  seriesType: "3i93lTkmuAV49s9nh0q8",
  portalAccess: "O0xmwyRqeNK2EA1GGGye",
  livingPracticeAccess: "1EnVtI70jC5MTshZjWvw",
};

// 90 days — must outlive GHL's webhook retry window so a late re-delivery can't
// double-credit a single follow-up (ADD path). Matches the reconcile worker's
// window; the invoice webhook uses 30d. (session-tracking-audit-2026-06-06 #1)
export const KV_TTL_SECONDS = 90 * 86400;

// Read a custom field value from a GHL contact object.
function getCustomFieldValue(contact, fieldId) {
  if (!contact.customFields) return null;
  const field = contact.customFields.find((f) => f.id === fieldId);
  return field ? (field.value ?? field.field_value ?? null) : null;
}

// Fetch the most recent order for a contact from GHL Payments API.
// Used when the webhook payload doesn't include product data.
// Returns { productId, orderId } or null.
async function fetchRecentOrder(context, contactId) {
  try {
    const url = `${GHL_API_BASE}/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=5`;
    const res = await ghlFetch(context, url);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ghl-purchase-webhook] Orders API failed (${res.status}): ${errText}`);
      return null;
    }

    const data = await res.json();
    const orders = data.data || data.orders || [];

    if (orders.length === 0) {
      console.log("[ghl-purchase-webhook] No orders found for contact via API");
      return null;
    }

    // Walk through orders (most recent first) looking for a recognized product
    for (const order of orders) {
      const items = order.items || order.lineItems || order.line_items || [];
      for (const item of items) {
        // GHL may nest the product ID under different keys
        const pid =
          item.product_id ||
          item.productId ||
          item._id ||
          item.priceId ||
          (item.price && item.price._id);
        const resolvedId = productIdForAnyId(pid) || pid;
        if (pid && PRODUCT_MAP[resolvedId]) {
          return {
            productId: resolvedId,
            orderId: order._id || order.id || order.orderId,
          };
        }
      }
    }

    // Log what we found so we can debug product ID matching
    const firstOrder = orders[0];
    const firstItems = firstOrder.items || firstOrder.lineItems || firstOrder.line_items || [];
    console.log(
      `[ghl-purchase-webhook] No recognized products in ${orders.length} orders. First order items: ${JSON.stringify(firstItems).slice(0, 500)}`
    );
    return null;
  } catch (err) {
    console.error(`[ghl-purchase-webhook] fetchRecentOrder error: ${err.message}`);
    return null;
  }
}

// Extract a value from the webhook payload, trying multiple possible keys.
function extractField(body, keys) {
  for (const key of keys) {
    const parts = key.split(".");
    let val = body;
    for (const part of parts) {
      if (val == null || typeof val !== "object") {
        val = undefined;
        break;
      }
      val = val[part];
    }
    if (val != null && val !== "") return String(val);
  }
  return null;
}

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  try {
    // ── 1. Verify webhook secret ──
    const expectedSecret = context.env.GHL_WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.error("[ghl-purchase-webhook] GHL_WEBHOOK_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    const providedSecret = context.request.headers.get("X-Webhook-Secret");
    if (providedSecret !== expectedSecret) {
      console.warn("[ghl-purchase-webhook] Invalid webhook secret");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers }
      );
    }

    // ── 2. Parse payload ──
    const body = await context.request.json();

    // Log full payload on first invocations for debugging field names
    console.log("[ghl-purchase-webhook] Received payload:", JSON.stringify(body).slice(0, 2000));

    const contactId = extractField(body, [
      "contact_id", "contactId", "contact.id",
      "data.contact_id", "data.contactId",
      "id",
    ]);

    const productId = extractField(body, [
      "product_id", "productId",
      "data.product_id", "data.productId",
      "items.0.product_id", "items.0.productId",
      "line_items.0.product_id",
    ]);

    // Note: top-level `id` is NOT in this list — see 2026-06-03 audit.
    // contactId also tries top-level `id` as a fallback; if both extractors
    // grabbed it, the KV idempotency key would become `order:<contactId>`
    // and could collide across contacts (silently). Better to fail to
    // resolve orderId and proceed without idempotency (logged) than to
    // silently corrupt the lock.
    let orderId = extractField(body, [
      "order_id", "orderId",
      "data.order_id", "data.orderId",
      "transaction_id", "transactionId",
    ]);
    // Last-resort: top-level `id` IS valid for orderId in some payloads,
    // but only if it isn't ALSO what contactId resolved to.
    if (!orderId) {
      const topLevelId = extractField(body, ["id", "data.id"]);
      if (topLevelId && topLevelId !== contactId) {
        orderId = topLevelId;
      } else if (topLevelId && topLevelId === contactId) {
        console.warn("[ghl-purchase-webhook] top-level `id` matches contactId — refusing to use as orderId (collision risk). Idempotency check skipped.");
      }
    }

    if (!contactId) {
      console.error("[ghl-purchase-webhook] No contactId found in payload");
      return new Response(
        JSON.stringify({ error: "Missing contactId" }),
        { status: 400, headers }
      );
    }

    // ── 3. Map product to package ──
    // The GHL Custom Webhook RAW BODY can only include contact fields,
    // not order/product fields. When productId is missing from the payload,
    // we look up the contact's most recent order via the GHL Payments API.
    let resolvedProductId = productIdForAnyId(productId) || productId;
    let resolvedOrderId = orderId;

    if (!resolvedProductId || !PRODUCT_MAP[resolvedProductId]) {
      console.log(`[ghl-purchase-webhook] Product ID missing or unrecognized in payload (${productId}) — querying GHL Orders API`);
      const orderLookup = await fetchRecentOrder(context, contactId);
      if (orderLookup) {
        resolvedProductId = orderLookup.productId;
        resolvedOrderId = resolvedOrderId || orderLookup.orderId;
        console.log(`[ghl-purchase-webhook] Resolved product via Orders API: ${resolvedProductId} (order: ${resolvedOrderId})`);
      } else {
        console.log("[ghl-purchase-webhook] Could not determine product from payload or API — skipping");
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "unrecognized product" }),
          { status: 200, headers }
        );
      }
    }

    resolvedProductId = productIdForAnyId(resolvedProductId) || resolvedProductId;
    const pkg = PRODUCT_MAP[resolvedProductId];
    console.log(`[ghl-purchase-webhook] Matched product: ${pkg.name} (add ${pkg.sessionsToAdd} sessions)`);

    // ── 4. Idempotency check via KV ──
    const kv = context.env.PURCHASE_KV;
    const idempotencyKey = resolvedOrderId ? `order:${resolvedOrderId}` : null;

    if (kv && idempotencyKey) {
      try {
        const existing = await kv.get(idempotencyKey);
        if (existing) {
          console.log(`[ghl-purchase-webhook] Order ${resolvedOrderId} already processed — skipping`);
          return new Response(
            JSON.stringify({ success: true, alreadyProcessed: true }),
            { status: 200, headers }
          );
        }
      } catch (err) {
        // KV read failed — proceed anyway (better to double-process than miss)
        console.warn(`[ghl-purchase-webhook] KV read failed: ${err.message} — proceeding without idempotency check`);
      }
    } else if (!kv) {
      console.warn("[ghl-purchase-webhook] PURCHASE_KV not bound — no idempotency protection");
    }

    // ── 5. Fetch contact from GHL ──
    const sanitizedContactId = contactId.trim().slice(0, 50);
    const contactRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${sanitizedContactId}`
    );

    if (!contactRes.ok) {
      console.error(`[ghl-purchase-webhook] Contact fetch failed: ${sanitizedContactId} (${contactRes.status})`);
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers }
      );
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // The $29 Assessment is a paid booking, not a session-credit purchase.
    // Book the selected slot and leave every practice / portal field alone.
    if (pkg.isAssessmentBooking) {
      let appointment = null;
      let bookingError = null;
      try {
        const token = await getGhlToken(context);
        appointment = await bookPaidBookingAppointment(context, contact, pkg, token);
        if (!appointment) {
          throw new Error("No requested assessment slot found on contact");
        }
        await recordPaidBooking(context, sanitizedContactId, pkg, appointment);
      } catch (err) {
        bookingError = err.message;
        console.error("[ghl-purchase-webhook] Assessment appointment booking failed:", err.message);
        try {
          await ghlFetch(
            context,
            `${GHL_API_BASE}/contacts/${sanitizedContactId}/notes`,
            {
              method: "POST",
              body: JSON.stringify({
                body: [
                  "URGENT — ASSESSMENT BOOKING RECONCILE NEEDED",
                  "",
                  "The Amari Assessment payment was received, but the appointment did not auto-book.",
                  `Error: ${err.message}`,
                  "",
                  "Action: check requested_session_slot and manually book the assessment on the Amari Assessment calendar.",
                ].join("\n"),
              }),
            },
          );
        } catch (noteErr) {
          console.error("[ghl-purchase-webhook] assessment reconcile note failed:", noteErr);
        }
      }

      if (kv && idempotencyKey) {
        try {
          await kv.put(idempotencyKey, JSON.stringify({
            contactId: sanitizedContactId,
            product: pkg.name,
            appointmentId: appointment?.id || appointment?.appointment?.id || null,
            bookingError,
            processedAt: new Date().toISOString(),
          }), { expirationTtl: KV_TTL_SECONDS });
        } catch (err) {
          console.warn(`[ghl-purchase-webhook] KV write failed: ${err.message} — assessment booking processed but not recorded`);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          contactId: sanitizedContactId,
          product: pkg.name,
          appointmentBooked: !!appointment,
          ...(bookingError ? { bookingError } : {}),
        }),
        { status: 200, headers },
      );
    }

    // ── 6. Compute new sessions_remaining ──
    // Series purchases and upgrades: SET to the package value (clean reset).
    // Single follow-ups (seriesType === null): ADD to current balance.
    const currentRemaining = parseInt(
      getCustomFieldValue(contact, FIELD_IDS.sessionsRemaining) ?? "0",
      10
    ) || 0;
    const newRemaining = pkg.seriesType !== null
      ? pkg.sessionsToAdd
      : currentRemaining + pkg.sessionsToAdd;

    // ── 7. Build field updates ──
    const fieldUpdates = [
      { id: FIELD_IDS.sessionsRemaining, field_value: String(newRemaining) },
      { id: FIELD_IDS.portalAccess, field_value: true },
    ];

    // Set series_type: for single follow-ups, only set if no existing series
    if (pkg.seriesType !== null) {
      fieldUpdates.push({ id: FIELD_IDS.seriesType, field_value: pkg.seriesType });
    } else {
      // Single follow-up — only set series_type if currently "none" or empty
      const currentSeriesType = getCustomFieldValue(contact, FIELD_IDS.seriesType);
      if (!currentSeriesType || currentSeriesType === "none") {
        fieldUpdates.push({ id: FIELD_IDS.seriesType, field_value: "none" });
      }
      // Otherwise keep existing series_type
    }

    // Set living_practice_access if this package includes it
    if (pkg.livingPractice) {
      fieldUpdates.push({ id: FIELD_IDS.livingPracticeAccess, field_value: true });
    }

    // ── 8. PUT updated fields to GHL ──
    const token = await getGhlToken(context);
    const updateRes = await fetch(`${GHL_API_BASE}/contacts/${sanitizedContactId}`, {
      method: "PUT",
      headers: ghlHeaders(token),
      body: JSON.stringify({ customFields: fieldUpdates }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(`[ghl-purchase-webhook] PUT failed for ${sanitizedContactId} (${updateRes.status}): ${errText}`);
      return new Response(
        JSON.stringify({ error: "Failed to update contact fields" }),
        { status: 500, headers }
      );
    }

    console.log(`[ghl-purchase-webhook] Updated ${sanitizedContactId}: sessions_remaining ${currentRemaining} → ${newRemaining} (${pkg.name})`);

    // ── 8b. Native-booking-flow initial session: also book the appointment ──
    // If this product is an Initial Session sold via the native flow, the
    // contact has requested_session_slot/calendar/type fields with the slot
    // they picked. Create the appointment on the calendar + tag the
    // contact. Legacy GHL-funnel purchases skip this branch (slot missing).
    if (pkg.isInitialBooking) {
      try {
        const appointment = await bookPaidBookingAppointment(
          context,
          contact,
          pkg,
          token,
        );
        if (appointment) {
          await recordPaidBooking(
            context,
            sanitizedContactId,
            pkg,
            appointment,
          );
        }
      } catch (err) {
        // Don't fail the whole webhook — the payment succeeded, the
        // sessions_remaining update succeeded. Surface the booking
        // failure via a contact note so Eben can recover manually.
        console.error(
          `[ghl-purchase-webhook] Initial session appointment booking failed:`,
          err.message,
        );
        try {
          await ghlFetch(
            context,
            `${GHL_API_BASE}/contacts/${sanitizedContactId}/notes`,
            {
              method: "POST",
              body: JSON.stringify({
                body: [
                  `URGENT — RECONCILE NEEDED`,
                  ``,
                  `${pkg.name} payment received and recorded, but the`,
                  `appointment failed to auto-book.`,
                  ``,
                  `Error: ${err.message}`,
                  ``,
                  `Action: manually book the slot on the ${pkg.name}`,
                  `calendar. Check the requested_session_slot custom field`,
                  `for the slot the customer picked.`,
                ].join("\n"),
              }),
            },
          );
        } catch (noteErr) {
          console.error("[ghl-purchase-webhook] urgent note failed:", noteErr);
        }
      }
    }

    // ── 9. Store order ID in KV for idempotency ──
    if (kv && idempotencyKey) {
      try {
        await kv.put(idempotencyKey, JSON.stringify({
          contactId: sanitizedContactId,
          product: pkg.name,
          sessionsAdded: pkg.sessionsToAdd,
          processedAt: new Date().toISOString(),
        }), { expirationTtl: KV_TTL_SECONDS });
      } catch (err) {
        console.warn(`[ghl-purchase-webhook] KV write failed: ${err.message} — order processed but not recorded`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        contactId: sanitizedContactId,
        product: pkg.name,
        sessionsRemaining: newRemaining,
      }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error("[ghl-purchase-webhook] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
