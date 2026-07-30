// Thin OpsEvent helpers for money/booking paths beyond Assessment.
// Never throws into callers — recordOpsEvent already swallows.

import { recordOpsEvent, openOpsIncident, resolveOpsIncident } from "./ops-events.js";
import { recordOpsError } from "./ops-alert.js";
import { describeSlotFields } from "./ops-assessment.js";

export { describeSlotFields };

function personLabel(contact) {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * Paid book paths that share the purchase-webhook book hop (Intro + portal $190).
 * Assessment stays in ops-assessment.js.
 */
export async function recordPaidBookPath(context, {
  pathId,
  source = "ghl-purchase-webhook",
  contact,
  productName,
  orderId,
  appointment,
  bookError,
  slotCondition,
  skippedReason,
  money,
  failTitle,
  lawId,
}) {
  const env = context?.env || {};
  const contactId = contact?.id || null;
  const label = personLabel(contact);
  const correlationId = orderId ? `order:${orderId}` : contactId ? `contact:${contactId}` : null;
  const moneyPayload = money || { product: productName || pathId };
  const eventIds = [];

  const pay = await recordOpsEvent(env, {
    pathId,
    hopId: "purchase_webhook",
    outcome: "ok",
    summary: `${productName || pathId} payment received by purchase webhook`,
    correlationId,
    contactId,
    personLabel: label,
    trigger: { type: "ghl.order_submitted", id: orderId || undefined },
    money: moneyPayload,
    source,
  });
  if (pay.id) eventIds.push(pay.id);

  const apptId =
    appointment?.id || appointment?.appointment?.id || (typeof appointment === "string" ? appointment : null);

  if (bookError) {
    const fail = await recordOpsEvent(env, {
      pathId,
      hopId: "create_appointment",
      outcome: "fail",
      reasonCode: "book_failed",
      summary: `${productName || pathId} paid but appointment did not auto-book`,
      correlationId,
      contactId,
      personLabel: label,
      condition: slotCondition || {
        expected: "requested_session_slot_iso bookable datetime",
        observed: "unknown",
      },
      money: moneyPayload,
      source,
    });
    if (fail.id) eventIds.push(fail.id);
    await openOpsIncident(
      env,
      {
        pathId,
        severity: "money",
        title: failTitle || `Paid ${productName || pathId}, no appointment`,
        contactId,
        personLabel: label,
        correlationId,
        failedHopId: "create_appointment",
        eventIds,
        lawId: lawId || undefined,
      },
      { context, alert: true },
    );
    await recordOpsError(env, source, `${productName || pathId} paid but appointment did not auto-book`, {
      contactId,
      product: productName,
      pathId,
      error: String(bookError.message || bookError).slice(0, 300),
      opsEventId: fail.id || null,
      correlationId,
    });
    return { eventIds, outcome: "fail" };
  }

  if (!appointment && skippedReason) {
    const skip = await recordOpsEvent(env, {
      pathId,
      hopId: "create_appointment",
      outcome: "skip",
      reasonCode: skippedReason,
      summary: `${pathId} book hop skipped`,
      correlationId,
      contactId,
      personLabel: label,
      condition: slotCondition || undefined,
      money: moneyPayload,
      source,
    });
    if (skip.id) eventIds.push(skip.id);
    return { eventIds, outcome: "skip" };
  }

  if (apptId || appointment) {
    const ok = await recordOpsEvent(env, {
      pathId,
      hopId: "create_appointment",
      outcome: "ok",
      reasonCode: "booked",
      summary: `Appointment booked${apptId ? ` (${apptId})` : ""}`,
      correlationId,
      contactId,
      personLabel: label,
      condition: slotCondition || undefined,
      money: moneyPayload,
      source,
    });
    if (ok.id) eventIds.push(ok.id);
    await resolveOpsIncident(env, {
      pathId,
      correlationId: correlationId || undefined,
      contactId: contactId || undefined,
    });
    return { eventIds, outcome: "ok", appointmentId: apptId };
  }

  const silent = await recordOpsEvent(env, {
    pathId,
    hopId: "create_appointment",
    outcome: "fail",
    reasonCode: "no_appointment_silent",
    summary: `${productName || pathId} paid but no appointment id and no explicit skip`,
    correlationId,
    contactId,
    personLabel: label,
    condition: slotCondition || {
      expected: "appointment created or explicit skip",
      observed: "null appointment",
    },
    money: moneyPayload,
    source,
  });
  if (silent.id) eventIds.push(silent.id);
  await openOpsIncident(
    env,
    {
      pathId,
      severity: "money",
      title: failTitle || `Paid ${productName || pathId}, no appointment`,
      contactId,
      personLabel: label,
      correlationId,
      failedHopId: "create_appointment",
      eventIds,
      lawId: lawId || undefined,
    },
    { context, alert: true },
  );
  return { eventIds, outcome: "fail" };
}

/** Single hop — fire-and-forget friendly. */
export async function emitPathHop(env, {
  pathId,
  hopId,
  outcome,
  summary,
  source,
  contactId = null,
  personLabel = null,
  correlationId = null,
  reasonCode = null,
  condition = null,
  money = null,
  trigger = null,
}) {
  return recordOpsEvent(env, {
    pathId,
    hopId,
    outcome,
    summary,
    source,
    contactId,
    personLabel,
    correlationId,
    reasonCode: reasonCode || undefined,
    condition: condition || undefined,
    money: money || undefined,
    trigger: trigger || undefined,
  });
}

/** Map purchase product → paid-book path id (null = not a watched paid-book). */
export function paidBookPathForProduct(productId, pkg) {
  if (!pkg?.isNativePaidBooking || pkg.isNonCreditBooking) return null;
  if (productId === "6998ace59dfde469ecb2aab6") return "portal_followup_paid_book";
  return "intro_paid_book";
}
