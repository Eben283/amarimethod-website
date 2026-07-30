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
import { FIELD_IDS as GHL_FIELD_IDS } from "../lib/ghl-fields.js";
import { timingSafeEqual } from "../lib/safe-equal.js";
import { appointmentEndTime, parsePacificWallClock } from "../lib/datetime.js";
import { claimProcessedEvent } from "../lib/processed-events.js";
import { recordOpsError } from "../lib/ops-alert.js";
import { checkPackageBalance } from "../lib/session-consistency.js";
import { recordSeriesPurchase } from "../lib/purchase-confirmations.js";
import { emitNurtureEvent } from "../lib/engine-forward.js";
import { describeSlotFields, recordAssessmentBookPath } from "../lib/ops-assessment.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// ── Product-to-package mapping ──
// Crediting now DERIVES from the single source of truth (functions/lib/
// ghl-products.js → PURCHASE_CREDIT_MAP). This file only overlays the two
// webhook-specific things the catalog doesn't carry:
//   1. booking metadata for native paid visits (calendar, title, tag)
//   2. the RETIRED legacy follow-up (67f57171), kept so old orders still credit.
// Draw-down follow-ups (69aee204 / 69aee3eb / 67b1299f) are excluded by the
// catalog itself (DRAW_DOWN_PRODUCT_IDS) — crediting them would inflate balances.

export const PAID_BOOKING_MAP = {
  "688a1cd770362828afbf08a2": {
    isNativePaidBooking: true,
    calendarId: "G7OAnnJuFbMF6nQSlZVQ",
    duplicateCalendarIds: ["G7OAnnJuFbMF6nQSlZVQ", "ySmht5hx4uZGEpgZrlCw"],
    durationMinutes: 60,
    sessionTitle: "Amari Method Initial Session — In Person",
    sessionTag: "booked-initial-in-person",
  },
  "690b6b4d333ffa59d40c1823": {
    isNativePaidBooking: true,
    calendarId: "ySmht5hx4uZGEpgZrlCw",
    duplicateCalendarIds: ["G7OAnnJuFbMF6nQSlZVQ", "ySmht5hx4uZGEpgZrlCw"],
    durationMinutes: 60,
    sessionTitle: "Amari Method Initial Session — Virtual",
    sessionTag: "booked-initial-virtual",
  },
  "6a66cf0103821ea09ea13f1b": {
    isNativePaidBooking: true,
    isNonCreditBooking: true,
    name: "Amari Assessment",
    calendarId: "EM6vB2mq7EAdGCbUb3j1",
    duplicateCalendarIds: ["EM6vB2mq7EAdGCbUb3j1"],
    durationMinutes: 40,
    sessionTitle: "Amari Assessment — In Person",
    sessionTag: null,
  },
  // Existing $190 Single Follow-up product + payment link (staff-send-paylink).
  // One product covers in-person + virtual; calendar comes from requested_session_calendar.
  "6998ace59dfde469ecb2aab6": {
    isNativePaidBooking: true,
    calendarId: "SKDVOL8wtUN6Ne0ppbC9",
    duplicateCalendarIds: ["SKDVOL8wtUN6Ne0ppbC9", "oVn77FcecFY16iS2pHyP"],
    allowRequestedCalendar: true,
    durationMinutes: 50,
    sessionTitle: "Amari Method Follow-up Session",
    sessionTag: "booked-followup-paid",
  },
};

const LEGACY_CREDITS = {
  // Retired "Amari Method: Follow-Up Sessions" — no longer sold; kept so any
  // historical order still credits +1. Not in the catalog (it classifies retired).
  "67f57171b6b1019c7b0233cc": { name: "Single Follow-up", sessionsToAdd: 1, seriesType: null, livingPractice: false },
};

export const PRODUCT_MAP = (() => {
  const m = { ...LEGACY_CREDITS };
  for (const [id, entry] of Object.entries(PURCHASE_CREDIT_MAP)) {
    m[id] = PAID_BOOKING_MAP[id] ? { ...entry, ...PAID_BOOKING_MAP[id] } : { ...entry };
  }
  return m;
})();

function isRecognizedPurchaseProduct(productId) {
  return !!(PRODUCT_MAP[productId] || PAID_BOOKING_MAP[productId]);
}

// Pure: the productId of a credited product on an order, or null. (R4 fix,
// 2026-06-08.) Reads the NESTED ids GHL actually sends — `item.product._id`
// (= productId) and `item.price._id` (= priceId) — plus legacy flat fallbacks,
// and normalizes ANY id → productId via productIdForAnyId so a priceId resolves
// against the productId-keyed catalog. The prior `fetchRecentOrder` extraction
// never read `item.product._id` and treated `item._id` (the LINE-ITEM id) as a
// product, so on a real order the Orders-API backup couldn't resolve a product
// and silently skipped crediting. Draw-down-only orders still return null.
export function resolveOrderProductId(order) {
  const items = order?.items || order?.lineItems || order?.line_items || [];
  for (const item of items) {
    const rawId =
      item?.product?._id || item?.price?._id ||
      item?.product_id || item?.productId || item?.priceId;
    const productId = productIdForAnyId(rawId);
    if (productId && isRecognizedPurchaseProduct(productId)) return productId;
  }
  return null;
}

// Pure: is this GHL order safe to credit from the Orders-API fallback? Mirrors
// the guards in session-ledger.js → classifyOrder so the webhook and the ledger
// agree on what counts as a real purchase. (H3 fix, 2026-06-11 review.) Without
// this, the fallback credited:
//   • sourceType="calendar" placeholder orders — GHL auto-creates one per
//     booking; crediting it re-adds a session under a different orderId.
//   • $0 fully-couponed orders (e.g. a 100%-off referral coupon) — still carry
//     the package productId, so the fallback granted the full pack for $0.
export function isCreditableOrder(order) {
  const status = (order?.status || "").toLowerCase();
  const amount = Number(order?.amount || 0);
  const sourceType = (order?.sourceType || order?.source?.type || "").toLowerCase();
  if (status !== "completed") return false;
  if (amount <= 0) return false;
  if (sourceType === "calendar") return false;
  return true;
}

// Field keys + IDs for the slot-request fields written by create-checkout.js
// (Settings → Custom Fields → Session Tracking folder).
// Contact GET returns `{ id, value }` only (no fieldKey) — always resolve by id.
const REQUESTED_SLOT_FIELD_KEYS = [
  "requested_session_slot_iso",
  "requested_session_slot",
  "requested_session_calendar",
  "requested_session_type",
];
const REQUESTED_SLOT_FIELD_IDS = {
  slotIso: GHL_FIELD_IDS.requested_session_slot_iso,
  slot: GHL_FIELD_IDS.requested_session_slot,
  calendar: GHL_FIELD_IDS.requested_session_calendar,
  type: GHL_FIELD_IDS.requested_session_type,
};

const SLOT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const CHECKOUT_NOTE_SLOT_RE =
  /Requested slot:\s*(\d{4}-\d{2}-\d{2}T[0-9:+-]+)/i;

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

function getRequestedSessionField(contact, shortKey, fieldId) {
  const byId = getCustomFieldValue(contact, fieldId);
  if (byId != null && byId !== "") return byId;
  return (
    getCustomFieldValueByKey(contact, shortKey) ||
    getCustomFieldValueByKey(contact, `contact.${shortKey}`)
  );
}

function isBookableSlot(value) {
  return typeof value === "string" && SLOT_ISO_RE.test(value);
}

/**
 * Pull the full ISO slot from the most recent native-checkout audit note.
 * create-checkout always writes "Requested slot: <ISO> (...)" even when the
 * GHL DATE field truncates the stored custom-field value to YYYY-MM-DD.
 */
async function readSlotFromCheckoutNote(context, contactId) {
  try {
    const res = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${contactId}/notes`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const notes = data.notes || [];
    for (const note of notes) {
      const body = note.body || "";
      if (!/Native booking flow/i.test(body)) continue;
      const match = body.match(CHECKOUT_NOTE_SLOT_RE);
      if (match && isBookableSlot(match[1])) return match[1];
    }
  } catch (err) {
    console.warn(
      `[ghl-purchase-webhook] checkout-note slot lookup failed: ${err.message}`,
    );
  }
  return null;
}

/**
 * Resolve the exact picked start time for a native paid booking.
 * Prefer the TEXT iso field; fall back to a full datetime in the DATE field,
 * then to the checkout audit note. Date-only values are not bookable.
 */
async function resolveRequestedSlot(context, contact) {
  const iso = getRequestedSessionField(
    contact,
    "requested_session_slot_iso",
    REQUESTED_SLOT_FIELD_IDS.slotIso,
  );
  if (isBookableSlot(iso)) return String(iso).trim();

  const slot = getRequestedSessionField(
    contact,
    "requested_session_slot",
    REQUESTED_SLOT_FIELD_IDS.slot,
  );
  if (isBookableSlot(slot)) return String(slot).trim();

  const fromNote = await readSlotFromCheckoutNote(context, contact.id);
  if (fromNote) {
    console.warn(
      `[ghl-purchase-webhook] Using checkout-note slot for ${contact.id} (custom field missing/truncated)`,
    );
    return fromNote;
  }

  return null;
}

function contactLooksLikeNativeCheckout(contact) {
  const type = getRequestedSessionField(
    contact,
    "requested_session_type",
    REQUESTED_SLOT_FIELD_IDS.type,
  );
  const calendar = getRequestedSessionField(
    contact,
    "requested_session_calendar",
    REQUESTED_SLOT_FIELD_IDS.calendar,
  );
  const tags = contact.tags || [];
  return !!(
    type ||
    calendar ||
    tags.includes("native-booking-started")
  );
}

/**
 * Book the appointment that the user picked during native-flow checkout.
 * Reads the picked slot off the contact (by field id — GHL contact GET does
 * not return fieldKey). If no bookable slot is present:
 *   - legacy GHL calendar/funnel purchases → skip (they already booked)
 *   - native checkout (tags/type/calendar present) → throw so callers alert
 */
async function bookPaidBookingAppointment(context, contact, booking, token) {
  const slot = await resolveRequestedSlot(context, contact);
  if (!slot) {
    if (contactLooksLikeNativeCheckout(contact)) {
      throw new Error(
        "Native checkout payment received but no bookable requested_session_slot_iso/slot (time missing). Check checkout note for 'Requested slot'.",
      );
    }
    console.log(
      `[ghl-purchase-webhook] No requested_session_slot on contact ${contact.id} — assuming calendar checkout or legacy funnel purchase, skipping appointment creation`,
    );
    return null;
  }

  const requestedCalendar = getRequestedSessionField(
    contact,
    "requested_session_calendar",
    REQUESTED_SLOT_FIELD_IDS.calendar,
  );
  const allowedCalendars = booking.duplicateCalendarIds || [booking.calendarId];
  let calendarId = booking.calendarId;
  if (requestedCalendar) {
    if (allowedCalendars.includes(requestedCalendar)) {
      // Single follow-up (and similar) products serve multiple calendars; honor
      // the calendar the client picked in the Amari booking UI.
      calendarId = requestedCalendar;
    } else if (requestedCalendar !== booking.calendarId) {
      console.warn(
        `[ghl-purchase-webhook] Requested calendar ${requestedCalendar} does not match ${booking.calendarId} for ${contact.id} — skipping stale slot`,
      );
      return null;
    }
  }

  const sessionTitle =
    calendarId === "oVn77FcecFY16iS2pHyP"
      ? "Amari Method Follow-up Session — Virtual"
      : calendarId === "SKDVOL8wtUN6Ne0ppbC9"
        ? "Amari Method Follow-up Session — In Person"
        : booking.sessionTitle;

  // Guard against duplicate-booking: if the contact already has an upcoming
  // appointment for this booking type, skip the auto-book. A requested slot
  // can be stale from an abandoned website flow, which would otherwise create
  // a second appointment for a slot the customer never paid to reserve.
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
        if (!allowedCalendars.includes(a.calendarId)) return false;
        // Naive-Pacific parse: a raw UTC parse made a later-today initial
        // read as PAST from ~8am PT, so the future-booking check missed it.
        const startMs = parsePacificWallClock(a.startTime || "");
        if (!Number.isFinite(startMs) || startMs < now) return false;
        const status = (a.appointmentStatus || "").toLowerCase();
        if (status === "cancelled" || status === "noshow") return false;
        return true;
      });
      if (existing) {
        console.log(
          `[ghl-purchase-webhook] Contact ${contact.id} already has an upcoming matching appointment (${existing.id} at ${existing.startTime}) — skipping auto-book to avoid duplicate`,
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

  // Compute endTime, preserving both the instant (start + duration) and the
  // slot's timezone offset (GHL rejects appointments where the offset is
  // stripped). See functions/lib/datetime.js.
  const endTime = appointmentEndTime(slot, booking.durationMinutes);

  const payload = {
    calendarId,
    locationId: LOCATION_ID,
    contactId: contact.id,
    startTime: slot,
    endTime,
    selectedTimezone: "America/Los_Angeles", // safe default; appointment's local TZ
    title: sessionTitle,
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
    `[ghl-purchase-webhook] Booked paid native appointment for ${contact.id} at ${slot} on ${calendarId} (apptId: ${data.id || data.appointment?.id})`,
  );

  return data;
}

/**
 * After booking, apply tags + write a confirmation note. Best-effort —
 * non-fatal if any fail.
 */
async function recordPaidBooking(context, contactId, booking, appointment) {
  const tags = ["paid-via-native-checkout"];
  if (booking.sessionTag) tags.unshift(booking.sessionTag);
  try {
    await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${contactId}/tags`,
      {
        method: "POST",
        body: JSON.stringify({ tags }),
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
            `Booking: ${booking.name || booking.sessionTitle}`,
            `Appointment id: ${apptId}`,
            `Calendar: ${booking.calendarId}`,
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

// ── GHL custom field IDs (single-sourced from lib/ghl-fields.js) ──
const FIELD_IDS = {
  sessionsRemaining: GHL_FIELD_IDS.sessions_remaining,
  seriesType: GHL_FIELD_IDS.series_type,
  portalAccess: GHL_FIELD_IDS.portal_access,
  livingPracticeAccess: GHL_FIELD_IDS.living_practice_access,
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

    // Walk orders (most recent first) for a recognized product. Reads the nested
    // ids real GHL orders carry + normalizes priceId→productId (see
    // resolveOrderProductId). Skip orders that aren't safe to credit — unpaid,
    // $0 (fully-couponed), or sourceType=calendar booking placeholders — so the
    // fallback can't double-credit or grant a free pack (H3, isCreditableOrder).
    for (const order of orders) {
      if (!isCreditableOrder(order)) {
        console.log(
          `[ghl-purchase-webhook] Skipping non-creditable order ${order._id || order.id || "?"} ` +
          `(status=${order.status}, amount=${order.amount}, sourceType=${order.sourceType || order.source?.type})`
        );
        continue;
      }
      const productId = resolveOrderProductId(order);
      if (productId) {
        return {
          productId,
          orderId: order._id || order.id || order.orderId,
        };
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
    if (!timingSafeEqual(providedSecret || "", expectedSecret)) {
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
    let resolvedProductId = productId;
    let resolvedOrderId = orderId;

    if (!resolvedProductId || !isRecognizedPurchaseProduct(resolvedProductId)) {
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

    const pkg = PRODUCT_MAP[resolvedProductId] || null;
    const booking = PAID_BOOKING_MAP[resolvedProductId] || null;
    const productName = pkg?.name || booking?.name || booking?.sessionTitle || resolvedProductId;
    console.log(
      pkg
        ? `[ghl-purchase-webhook] Matched product: ${pkg.name} (add ${pkg.sessionsToAdd} sessions)`
        : `[ghl-purchase-webhook] Matched non-credit paid booking: ${productName}`,
    );

    // ── 4. Idempotency check ──
    // Primary: D1 atomic INSERT — race-safe (two concurrent requests can't both
    // pass a KV read before either writes, but only one INSERT wins a PRIMARY KEY
    // conflict). Fallback to KV read-then-write when D1 isn't bound (test envs,
    // local dev). See functions/lib/processed-events.js.
    const kv = context.env.PURCHASE_KV;
    const idempotencyKey = resolvedOrderId ? `order:${resolvedOrderId}` : null;
    let usedD1 = false;

    if (idempotencyKey) {
      try {
        const claim = await claimProcessedEvent(context.env.ATTEND_DB, idempotencyKey);
        if (claim !== null) {
          // D1 is available — trust its atomic result exclusively.
          usedD1 = true;
          if (!claim.ok) {
            console.log(`[ghl-purchase-webhook] Order ${resolvedOrderId} already processed (D1) — skipping`);
            return new Response(
              JSON.stringify({ success: true, alreadyProcessed: true }),
              { status: 200, headers }
            );
          }
          console.log(`[ghl-purchase-webhook] D1 claim won for order ${resolvedOrderId}`);
        }
      } catch (err) {
        console.warn(`[ghl-purchase-webhook] D1 idempotency failed: ${err.message} — falling back to KV`);
      }
    }

    if (!usedD1) {
      if (kv && idempotencyKey) {
        try {
          const existing = await kv.get(idempotencyKey);
          if (existing) {
            console.log(`[ghl-purchase-webhook] Order ${resolvedOrderId} already processed (KV) — skipping`);
            return new Response(
              JSON.stringify({ success: true, alreadyProcessed: true }),
              { status: 200, headers }
            );
          }
        } catch (err) {
          console.warn(`[ghl-purchase-webhook] KV read failed: ${err.message} — proceeding without idempotency check`);
        }
      } else if (!kv) {
        console.warn("[ghl-purchase-webhook] No idempotency binding (ATTEND_DB or PURCHASE_KV) — no race protection");
      }
    }

    // ── 5. Fetch contact from GHL ──
    const sanitizedContactId = contactId.trim().slice(0, 50);
    const contactRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${sanitizedContactId}`
    );

    if (!contactRes.ok) {
      console.error(`[ghl-purchase-webhook] Contact fetch failed: ${sanitizedContactId} (${contactRes.status})`);
      context.waitUntil(recordOpsError(context.env, "ghl-purchase-webhook",
        "Contact fetch failed after payment — fulfillment not completed",
        { contactId: sanitizedContactId, status: contactRes.status, product: productName }));
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers }
      );
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // ── 5b. Native Assessment purchase: book only, never credit ──
    // The $29 Assessment is a paid booking, not a prepaid session package.
    // It must not change sessions_remaining, series_type, portal access, or
    // the at-home-practice access. It uses the same selected-slot handoff as
    // native Initial bookings so the existing confirmed-only reminder and
    // cancellation workflows own all client communication.
    if (booking?.isNonCreditBooking) {
      const token = await getGhlToken(context);
      let appointment = null;
      let bookError = null;
      let skippedReason = null;
      const slotIsoRaw = getRequestedSessionField(
        contact,
        "requested_session_slot_iso",
        REQUESTED_SLOT_FIELD_IDS.slotIso,
      );
      const slotDateRaw = getRequestedSessionField(
        contact,
        "requested_session_slot",
        REQUESTED_SLOT_FIELD_IDS.slot,
      );
      const slotTypeRaw = getRequestedSessionField(
        contact,
        "requested_session_type",
        REQUESTED_SLOT_FIELD_IDS.type,
      );
      const slotCalRaw = getRequestedSessionField(
        contact,
        "requested_session_calendar",
        REQUESTED_SLOT_FIELD_IDS.calendar,
      );
      try {
        appointment = await bookPaidBookingAppointment(context, contact, booking, token);
        if (appointment) {
          await recordPaidBooking(context, sanitizedContactId, booking, appointment);
        } else if (!contactLooksLikeNativeCheckout(contact)) {
          skippedReason = "legacy_or_calendar_checkout";
        }
      } catch (err) {
        bookError = err;
        console.error(
          "[ghl-purchase-webhook] Assessment appointment booking failed:",
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
                  "URGENT — RECONCILE NEEDED",
                  "",
                  `${productName} payment received, but the appointment failed to auto-book.`,
                  "",
                  `Error: ${err.message}`,
                  "",
                  `Action: manually book the selected Assessment slot on ${booking.calendarId}.`,
                  "Check the requested_session_slot custom field first.",
                ].join("\n"),
              }),
            },
          );
        } catch (noteErr) {
          console.error("[ghl-purchase-webhook] Assessment recovery note failed:", noteErr);
        }
      }

      const slotCondition = {
        expected: "requested_session_slot_iso bookable datetime",
        observed: describeSlotFields({
          slotIso: slotIsoRaw,
          slotDate: slotDateRaw,
          type: slotTypeRaw,
          calendar: slotCalRaw,
        }),
      };
      // Amari Ops spine: always emit payment + book hop (ok/fail/skip) so path→why is real.
      // Awaited (not waitUntil) so Holly-class fails are durable before the 200 returns.
      // Flip alert + legacy ops:err mirror live inside recordAssessmentBookPath.
      try {
        await recordAssessmentBookPath(context, {
          contact,
          productName,
          orderId: resolvedOrderId,
          appointment,
          bookError,
          slotCondition,
          skippedReason,
        });
      } catch (opsErr) {
        console.error("[ghl-purchase-webhook] ops spine write failed:", opsErr?.message || opsErr);
      }

      if (kv && idempotencyKey) {
        try {
          await kv.put(idempotencyKey, JSON.stringify({
            contactId: sanitizedContactId,
            product: productName,
            sessionsAdded: 0,
            processedAt: new Date().toISOString(),
          }), { expirationTtl: KV_TTL_SECONDS });
        } catch (err) {
          console.warn(`[ghl-purchase-webhook] KV write failed: ${err.message} — Assessment booking processed but not recorded`);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          contactId: sanitizedContactId,
          product: productName,
          appointmentId: appointment?.id || appointment?.appointment?.id || null,
          sessionsAdded: 0,
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

    // ── 6b. Consistency guard (advisory) ──
    // Sanity-check the value we're about to SET against the package's own
    // session count before writing. Package purchases SET the balance, so
    // newRemaining should equal the credited amount and never exceed it or go
    // negative. We only check the SET path (seriesType !== null): the ADD path
    // (single follow-ups) legitimately pushes remaining above a single's "1"
    // when a client already has a pack. attended is not cheaply available here
    // (no ledger derivation on this hot path), so we pass null and only the
    // bounds are checked — see session-consistency.js for why this is
    // package-attended, never lifetime sessions_completed.
    //
    // FLAG, don't reject: the payment already succeeded. A blocked write on a
    // real paid customer is worse than a flagged one, and the existing failure
    // paths in this handler (contact fetch, PUT) treat a missed write as an
    // ops alert, not a hard stop for the customer. So on violation we record an
    // ops alert + console.error and continue to write.
    if (pkg.seriesType !== null) {
      const balanceCheck = checkPackageBalance({
        remaining: newRemaining,
        packageSize: pkg.sessionsToAdd,
        attended: null,
      });
      if (!balanceCheck.ok) {
        console.error(
          `[ghl-purchase-webhook] Balance consistency violation for ${sanitizedContactId} ` +
          `(${pkg.name}): ${balanceCheck.violation} — writing anyway (advisory)`,
        );
        context.waitUntil(recordOpsError(context.env, "ghl-purchase-webhook",
          "Session balance consistency violation on package purchase — value written anyway",
          { contactId: sanitizedContactId, product: pkg.name,
            attemptedRemaining: newRemaining, packageSize: pkg.sessionsToAdd,
            violation: balanceCheck.violation }));
      }
    }

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
      context.waitUntil(recordOpsError(context.env, "ghl-purchase-webhook",
        "GHL field update failed — payment received, sessions_remaining NOT updated",
        { contactId: sanitizedContactId, status: updateRes.status, product: pkg.name,
          attemptedRemaining: newRemaining, ghlError: String(errText).slice(0, 300) }));
      return new Response(
        JSON.stringify({ error: "Failed to update contact fields" }),
        { status: 500, headers }
      );
    }

    console.log(`[ghl-purchase-webhook] Updated ${sanitizedContactId}: sessions_remaining ${currentRemaining} → ${newRemaining} (${pkg.name})`);

    // Purchase event → nurture engine (Flow 3 exit fan-in matches the 4 series/upgrade
    // productIds; other products are ignored engine-side). Fire-and-forget, dormant until
    // the worker URL exists.
    emitNurtureEvent(context, { kind: "purchase", contactId: sanitizedContactId, productId: resolvedProductId });

    // ── 8c. Purchase-cluster seam (NON-BLOCKING — GHL exit Unit C) ──
    // Series/upgrade purchases cancel any pending Post-Initial Upgrade Offer timer and
    // record the confirmation (shadow mode: would_send only, no message leaves). Singles
    // (seriesType null) keep the offer alive by design; LP-standalone never reaches this
    // handler. No-ops without the AUTOMATION_DB binding; never throws.
    if (pkg.seriesType !== null) {
      const seam = await recordSeriesPurchase(context, {
        contactId: sanitizedContactId,
        seriesType: pkg.seriesType,
        classification: pkg.classification,
        ref: resolvedOrderId ? `order:${resolvedOrderId}` : `order:noid:${sanitizedContactId}:${Date.now()}`,
        source: "order-webhook",
      }, Date.now());
      if (!seam.ok) {
        console.error(`[ghl-purchase-webhook] purchase-cluster seam failed (non-fatal): ${seam.error}`);
      }
    }

    // ── 8b. Native-booking-flow initial session: also book the appointment ──
    // If this product is an Initial Session sold via the native flow, the
    // contact has requested_session_slot/calendar/type fields with the slot
    // they picked. Create the appointment on the calendar + tag the
    // contact. Legacy GHL-funnel purchases skip this branch (slot missing).
    if (pkg.isNativePaidBooking) {
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

    // ── 9. KV write for idempotency ──
    // Written EVEN when D1 claimed above: the series-reconcile worker dedupes
    // against this `order:` key (it has no D1 view of webhook-processed
    // orders), so a D1-only claim would silently disable the cross-system
    // dedup added 2026-07-02. Cheap, idempotent, 90-day TTL.
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
    context.waitUntil(recordOpsError(context.env, "ghl-purchase-webhook",
      "Unhandled error processing a purchase webhook",
      { message: String(err && err.message).slice(0, 300) }));
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
