const STATUSES = new Set(["paid", "comped", "on-package", "pay-next-visit", "owed", "unknown"]);
const METHODS = new Set(["stripe", "cash", "venmo", "check", "other"]);

export class OwnedAppointmentPaymentError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "OwnedAppointmentPaymentError";
    this.code = code;
    this.status = status;
  }
}

function optionalText(value, maximum) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > maximum) throw new OwnedAppointmentPaymentError("payment text is too long", "invalid_payment", 400);
  return text;
}

function normalizedPayment(input) {
  const status = String(input?.status || "").trim();
  const method = optionalText(input?.method, 40);
  const note = optionalText(input?.note, 1000);
  const source = optionalText(input?.source, 80) || "staff";
  const recordedBy = optionalText(input?.recordedBy, 160);
  const amountCents = input?.amountCents == null ? null : Number(input.amountCents);
  if (!STATUSES.has(status) || (method && !METHODS.has(method)) || !recordedBy ||
      (amountCents != null && (!Number.isInteger(amountCents) || amountCents < 0)) ||
      (status === "paid" && !method && source !== "stripe-auto")) {
    throw new OwnedAppointmentPaymentError("invalid appointment payment evidence", "invalid_payment", 400);
  }
  return { status, method, note, source, recordedBy, amountCents };
}

export async function recordOwnedAppointmentPayment(db, appointmentReference, contactReference, input, now) {
  if (!db) throw new Error("owned appointment storage is unavailable");
  const appointment = await db.prepare(
    `SELECT appointment.id, appointment.contact_id
       FROM appointments appointment
      WHERE (appointment.id = ? OR appointment.provider_appointment_id = ?)
        AND (appointment.contact_id = ? OR EXISTS (
          SELECT 1 FROM external_records external
           WHERE external.provider = 'ghl' AND external.object_type = 'contact'
             AND external.external_id = ? AND external.contact_id = appointment.contact_id
        ))
      ORDER BY CASE WHEN appointment.id = ? THEN 0 ELSE 1 END
      LIMIT 1`,
  ).bind(
    appointmentReference, appointmentReference, contactReference, contactReference, appointmentReference,
  ).first();
  if (!appointment) {
    throw new OwnedAppointmentPaymentError("appointment and contact identity do not match", "appointment_not_found", 404);
  }
  const payment = normalizedPayment(input);
  const eventId = `apaye_${crypto.randomUUID()}`;
  await db.batch([
    db.prepare(
      `INSERT INTO appointment_payment_events (
         id, appointment_id, contact_id, status, method, note, amount_cents,
         source, recorded_by, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      eventId, appointment.id, appointment.contact_id, payment.status, payment.method,
      payment.note, payment.amountCents, payment.source, payment.recordedBy, now,
    ),
    db.prepare(
      `INSERT INTO appointment_payment_records (
         appointment_id, contact_id, status, method, note, amount_cents,
         source, recorded_by, recorded_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(appointment_id) DO UPDATE SET
         contact_id = excluded.contact_id, status = excluded.status,
         method = excluded.method, note = excluded.note,
         amount_cents = excluded.amount_cents, source = excluded.source,
         recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at,
         updated_at = excluded.updated_at`,
    ).bind(
      appointment.id, appointment.contact_id, payment.status, payment.method,
      payment.note, payment.amountCents, payment.source, payment.recordedBy, now, now,
    ),
  ]);
  return {
    appointmentId: appointment.id,
    contactId: appointment.contact_id,
    ...payment,
    recordedAt: now,
  };
}
