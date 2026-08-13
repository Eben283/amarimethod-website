// One-minute recovery guard for the public $29 Assessment checkout.
//
// The authoritative path is GHL Order Submitted -> Pages
// /api/ghl-purchase-webhook. This worker deliberately does not replace that
// trigger. It only looks for a *recent* selected checkout slot that remains
// unbound, then invokes that exact handler with the same durable order/slot
// state machine. That closes the otherwise silent "card paid, webhook routed
// elsewhere" failure class without introducing a second booking implementation.

import { onRequestPost as fulfillPaidBooking } from "../../functions/api/ghl-purchase-webhook.js";
import { PAID_BOOKING_MAP } from "../../functions/api/ghl-purchase-webhook.js";
import { ghlFetch } from "../../functions/lib/ghl.js";
import { recordOpsError } from "../../functions/lib/ops-alert.js";
import { parsePacificWallClock } from "../../functions/lib/datetime.js";
import {
  flagPaidBookingIntentForManualReview,
  touchPaidBookingIntent,
} from "../../functions/lib/paid-booking-intents.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
export const ASSESSMENT_PRODUCT_ID = "6a66cf0103821ea09ea13f1b";
const MINIMUM_CHECKOUT_AGE_MS = 90_000;
const MAXIMUM_CHECKOUT_AGE_MS = 30 * 60_000;
const RETRY_INTERVAL_MS = 45_000;
const MAX_PER_CYCLE = 12;

function activeStatus(appointment) {
  return !["cancelled", "canceled", "noshow", "no-show"].includes(
    String(appointment?.appointmentStatus || appointment?.status || "").toLowerCase(),
  );
}

function appointmentStart(appointment) {
  return parsePacificWallClock(appointment?.startTime || appointment?.start_time || "");
}

function sameSlot(left, right) {
  const a = parsePacificWallClock(left);
  const b = appointmentStart(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 60_000;
}

async function laterManualAssessmentAppointment(env, intent, nowMs) {
  const booking = PAID_BOOKING_MAP[intent.product_id];
  const allowedCalendarIds = booking?.duplicateCalendarIds || [intent.calendar_id];
  const response = await ghlFetch(
    { env },
    `${GHL_API_BASE}/contacts/${encodeURIComponent(intent.contact_id)}/appointments`,
  );
  if (!response.ok) {
    throw new Error(`Could not inspect existing appointments before recovery (${response.status})`);
  }
  const data = await response.json();
  const appointments = data.events || data.appointments || [];
  return appointments.find((appointment) => (
    allowedCalendarIds.includes(appointment?.calendarId) &&
    activeStatus(appointment) &&
    appointmentStart(appointment) >= nowMs &&
    !sameSlot(intent.start_time, appointment)
  )) || null;
}

function workerContext(env, contactId) {
  return {
    env,
    request: new Request("https://internal.amari/ghl-purchase-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": env.GHL_WEBHOOK_SECRET || "",
      },
      // Match the actual GHL custom webhook body exactly. The handler reads
      // the most recent completed order from GHL, which gives it the durable
      // order identity before it books anything.
      body: JSON.stringify({ contact_id: intentSafeContactId(contactId), event: "order" }),
    }),
    // The handler uses waitUntil only for non-critical alert mirrors. Keep its
    // contract valid inside a scheduled worker; critical D1/booking writes are
    // awaited by the handler itself.
    waitUntil(promise) {
      Promise.resolve(promise).catch((error) => console.error("[paid-booking-watchdog] deferred handler task failed", error));
    },
  };
}

function intentSafeContactId(value) {
  return String(value || "").trim().slice(0, 50);
}

async function defaultFulfill(env, intent) {
  return fulfillPaidBooking(workerContext(env, intent.contact_id));
}

function parseResponse(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Recover recent unbound Assessment checkout intents. Dependency injection
 * keeps the minute-cycle policy testable without calling GHL or Pages.
 */
export async function reconcilePaidBookingIntents(env, nowMs = Date.now(), dependencies = {}) {
  if (!env?.ATTEND_DB || !env?.GHL_WEBHOOK_SECRET) {
    return { checked: 0, recovered: 0, waitingForPayment: 0, manualReview: 0, errors: 0, skipped: "not-configured" };
  }

  const rows = await env.ATTEND_DB.prepare(
    `SELECT intent_id, contact_id, product_id, calendar_id, start_time, timezone,
            status, order_id, appointment_id, created_at, expires_at, updated_at
       FROM paid_booking_intents
      WHERE product_id = ? AND status = 'pending'
        AND created_at <= ? AND created_at >= ?
        AND expires_at >= ? AND updated_at <= ?
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(
    ASSESSMENT_PRODUCT_ID,
    nowMs - MINIMUM_CHECKOUT_AGE_MS,
    nowMs - MAXIMUM_CHECKOUT_AGE_MS,
    nowMs,
    nowMs - RETRY_INTERVAL_MS,
    MAX_PER_CYCLE,
  ).all();

  const intents = rows?.results || [];
  const findManualAppointment = dependencies.findManualAppointment || laterManualAssessmentAppointment;
  const fulfill = dependencies.fulfill || defaultFulfill;
  const alert = dependencies.recordOpsError || recordOpsError;
  let recovered = 0;
  let waitingForPayment = 0;
  let manualReview = 0;
  let errors = 0;

  for (const intent of intents) {
    try {
      // Guard before invoking a booking operation. A different active
      // Assessment appointment means a person has already intervened; stop
      // permanently and make the exception visible rather than double-book.
      const manualAppointment = await findManualAppointment(env, intent, nowMs);
      if (manualAppointment) {
        await flagPaidBookingIntentForManualReview(env.ATTEND_DB, intent.intent_id, { now: nowMs });
        await alert(env, "paid-booking-watchdog", "Paid Assessment requires staff review — a different appointment already exists", {
          intentId: intent.intent_id,
          contactId: intent.contact_id,
          selectedStartTime: intent.start_time,
          existingAppointmentId: manualAppointment.id || null,
          existingStartTime: manualAppointment.startTime || null,
        });
        manualReview += 1;
        continue;
      }

      const response = await fulfill(env, intent);
      const payload = parseResponse(await response.text());
      if (response.ok && payload?.success) {
        if (payload.skipped) waitingForPayment += 1;
        else recovered += 1;
      } else if (payload?.manualReview) {
        await flagPaidBookingIntentForManualReview(env.ATTEND_DB, intent.intent_id, { now: nowMs });
        await alert(env, "paid-booking-watchdog", "Paid Assessment recovery stopped for staff review", {
          intentId: intent.intent_id,
          contactId: intent.contact_id,
          selectedStartTime: intent.start_time,
          status: response.status,
          reason: payload?.error || "manual review response",
        });
        manualReview += 1;
      } else {
        errors += 1;
        await alert(env, "paid-booking-watchdog", "Paid Assessment recovery retry failed", {
          intentId: intent.intent_id,
          contactId: intent.contact_id,
          selectedStartTime: intent.start_time,
          status: response.status,
          reason: payload?.error || "unexpected recovery response",
        });
      }
      // Mark every non-terminal attempt so this can run once per minute
      // without creating an unbounded GHL order-query storm while a person is
      // still on the payment page.
      await touchPaidBookingIntent(env.ATTEND_DB, intent.intent_id, { now: nowMs });
    } catch (error) {
      errors += 1;
      await alert(env, "paid-booking-watchdog", "Paid Assessment recovery inspection failed", {
        intentId: intent.intent_id,
        contactId: intent.contact_id,
        selectedStartTime: intent.start_time,
        error: String(error?.message || error).slice(0, 300),
      });
      await touchPaidBookingIntent(env.ATTEND_DB, intent.intent_id, { now: nowMs });
    }
  }

  return { checked: intents.length, recovered, waitingForPayment, manualReview, errors };
}

export const __test = {
  MINIMUM_CHECKOUT_AGE_MS,
  MAXIMUM_CHECKOUT_AGE_MS,
  RETRY_INTERVAL_MS,
  MAX_PER_CYCLE,
  sameSlot,
};
