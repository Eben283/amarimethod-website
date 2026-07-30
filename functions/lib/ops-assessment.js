// Assessment paid→book path emitters (Amari Ops Phase 1).
// Reconstructs Holly-class fails: payment received + slot condition + book outcome.

import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";
import { openOpsIncident, recordOpsEvent, resolveOpsIncident } from "./ops-events.js";
import { recordOpsError } from "./ops-alert.js";

const SOURCE = "ghl-purchase-webhook:assessment";

/**
 * Human-readable view of slot fields on the contact (for condition.observed).
 * Pure — no I/O. Callers pass the same getters they use to book.
 */
export function describeSlotFields({ slotIso, slotDate, type, calendar, fromNote }) {
  const parts = [];
  parts.push(`slot_iso=${slotIso == null || slotIso === "" ? "null" : JSON.stringify(String(slotIso))}`);
  parts.push(`slot=${slotDate == null || slotDate === "" ? "null" : JSON.stringify(String(slotDate))}`);
  if (type != null && type !== "") parts.push(`type=${type}`);
  if (calendar != null && calendar !== "") parts.push(`calendar=${calendar}`);
  if (fromNote) parts.push("note_fallback=yes");
  return parts.join("; ");
}

function personLabel(contact) {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  return name || null;
}

function moneyFor(productName, orderId) {
  return {
    product: productName || "Amari Assessment",
    amountCents: 2900,
    orderId: orderId || undefined,
  };
}

/**
 * After Assessment payment webhook: record payment hop + book outcome; open/resolve incident.
 * Never throws.
 */
export async function recordAssessmentBookPath(context, {
  contact,
  productName,
  orderId,
  appointment,
  bookError,
  slotCondition,
  skippedReason,
}) {
  const env = context?.env || {};
  const contactId = contact?.id || null;
  const label = personLabel(contact);
  const correlationId = orderId ? `order:${orderId}` : contactId ? `contact:${contactId}` : null;
  const money = moneyFor(productName, orderId);
  const eventIds = [];

  const pay = await recordOpsEvent(env, {
    pathId: PATH_ASSESSMENT_PAID_BOOK,
    hopId: "purchase_webhook",
    outcome: "ok",
    summary: "Assessment payment received by purchase webhook",
    correlationId,
    contactId,
    personLabel: label,
    trigger: { type: "ghl.order_submitted", id: orderId || undefined },
    money,
    source: SOURCE,
  });
  if (pay.id) eventIds.push(pay.id);

  const apptId =
    appointment?.id || appointment?.appointment?.id || (typeof appointment === "string" ? appointment : null);

  if (bookError) {
    const fail = await recordOpsEvent(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      hopId: "create_appointment",
      outcome: "fail",
      reasonCode: "book_failed",
      summary: "Assessment paid but appointment did not auto-book",
      correlationId,
      contactId,
      personLabel: label,
      condition: slotCondition || {
        expected: "requested_session_slot_iso bookable datetime",
        observed: "unknown",
      },
      money,
      source: SOURCE,
    });
    if (fail.id) eventIds.push(fail.id);

    await openOpsIncident(
      env,
      {
        pathId: PATH_ASSESSMENT_PAID_BOOK,
        severity: "money",
        title: "Paid Assessment, no appointment",
        contactId,
        personLabel: label,
        correlationId,
        failedHopId: "create_appointment",
        eventIds,
        lawId: "L_paid_assessment_has_appt",
      },
      { context, alert: true },
    );

    // Transition mirror into legacy ops:err sink.
    await recordOpsError(env, SOURCE, "Assessment payment received, but appointment did not auto-book", {
      contactId,
      product: productName,
      error: String(bookError.message || bookError).slice(0, 300),
      opsEventId: fail.id || null,
      correlationId,
    });
    return { eventIds, outcome: "fail" };
  }

  if (!appointment && skippedReason) {
    const skip = await recordOpsEvent(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      hopId: "create_appointment",
      outcome: "skip",
      reasonCode: skippedReason,
      summary: "Assessment book hop skipped",
      correlationId,
      contactId,
      personLabel: label,
      condition: slotCondition || undefined,
      money,
      source: SOURCE,
    });
    if (skip.id) eventIds.push(skip.id);
    return { eventIds, outcome: "skip" };
  }

  if (apptId || appointment) {
    const ok = await recordOpsEvent(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      hopId: "create_appointment",
      outcome: "ok",
      reasonCode: "booked",
      summary: `Assessment appointment booked${apptId ? ` (${apptId})` : ""}`,
      correlationId,
      contactId,
      personLabel: label,
      condition: slotCondition || undefined,
      money,
      source: SOURCE,
    });
    if (ok.id) eventIds.push(ok.id);
    await resolveOpsIncident(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      correlationId: correlationId || undefined,
      contactId: contactId || undefined,
    });
    return { eventIds, outcome: "ok", appointmentId: apptId };
  }

  // Paid, no appointment, no throw, no explicit skip — treat as fail (Holly-class silence).
  const silent = await recordOpsEvent(env, {
    pathId: PATH_ASSESSMENT_PAID_BOOK,
    hopId: "create_appointment",
    outcome: "fail",
    reasonCode: "no_appointment_silent",
    summary: "Assessment paid but no appointment id and no explicit skip",
    correlationId,
    contactId,
    personLabel: label,
    condition: slotCondition || {
      expected: "appointment created or explicit skip",
      observed: "null appointment",
    },
    money,
    source: SOURCE,
  });
  if (silent.id) eventIds.push(silent.id);
  await openOpsIncident(
    env,
    {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      severity: "money",
      title: "Paid Assessment, no appointment",
      contactId,
      personLabel: label,
      correlationId,
      failedHopId: "create_appointment",
      eventIds,
      lawId: "L_paid_assessment_has_appt",
    },
    { context, alert: true },
  );
  return { eventIds, outcome: "fail" };
}

/** Checkout hop for Assessment native flow. */
export async function recordAssessmentCheckout(env, {
  contactId,
  personLabel,
  startTime,
  sessionType,
}) {
  return recordOpsEvent(env, {
    pathId: PATH_ASSESSMENT_PAID_BOOK,
    hopId: "create_checkout",
    outcome: "ok",
    summary: "Assessment checkout created; contact slot fields written",
    correlationId: contactId && startTime ? `checkout:${contactId}:${startTime}` : undefined,
    contactId,
    personLabel: personLabel || null,
    trigger: { type: "book.create_checkout", id: sessionType },
    condition: {
      expected: "requested_session_slot_iso set to selected startTime",
      observed: startTime ? String(startTime) : "null",
    },
    money: { product: "Amari Assessment", amountCents: 2900 },
    source: "book/create-checkout:assessment",
  });
}
