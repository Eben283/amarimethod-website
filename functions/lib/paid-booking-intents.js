// Order-to-slot correlation for paid native bookings.
//
// GHL payment-link order webhooks identify the contact and order but do not
// reliably echo arbitrary checkout metadata. Preserve each selected slot in D1
// before redirecting to payment, then bind an order only when exactly one
// compatible intent exists. Ambiguity is a staff-review condition, never a
// reason to guess from mutable contact custom fields.

function changesOf(result) {
  return result?.meta?.changes ?? result?.changes ?? 0;
}

function normalize(row) {
  if (!row) return null;
  return {
    intentId: row.intent_id,
    contactId: row.contact_id,
    productId: row.product_id,
    calendarId: row.calendar_id,
    startTime: row.start_time,
    timezone: row.timezone,
    status: row.status,
    orderId: row.order_id || null,
    appointmentId: row.appointment_id || null,
    participantAgreementVersion: row.participant_agreement_version || null,
    participantAgreementAcceptedAt: row.participant_agreement_accepted_at === null || row.participant_agreement_accepted_at === undefined
      ? null
      : Number(row.participant_agreement_accepted_at),
    participantAgreementIp: row.participant_agreement_ip || null,
    participantAgreementUserAgent: row.participant_agreement_user_agent || null,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

function sameIntent(row, input) {
  return row.contact_id === input.contactId &&
    row.product_id === input.productId &&
    row.calendar_id === input.calendarId &&
    row.start_time === input.startTime &&
    row.timezone === input.timezone &&
    (row.participant_agreement_version || null) === (input.participantAgreementVersion || null);
}

export async function createPaidBookingIntent(db, input, options = {}) {
  if (!db) throw new Error("ATTEND_DB paid-booking intent state is unavailable");
  if (!input?.intentId || !input?.contactId || !input?.productId || !input?.calendarId || !input?.startTime || !input?.timezone) {
    throw new TypeError("complete paid-booking intent required");
  }
  if (input.participantAgreementVersion && !Number.isSafeInteger(input.participantAgreementAcceptedAt)) {
    throw new TypeError("participant agreement acceptance timestamp required");
  }
  const now = Number(options.now ?? Date.now());
  const expiresAt = now + Number(options.ttlMs ?? 24 * 60 * 60 * 1000);
  const inserted = await db.prepare(
    `INSERT INTO paid_booking_intents
      (intent_id, contact_id, product_id, calendar_id, start_time, timezone,
       status, order_id, appointment_id, participant_agreement_version,
       participant_agreement_accepted_at, participant_agreement_ip,
       participant_agreement_user_agent, created_at, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(intent_id) DO NOTHING`,
  ).bind(
    input.intentId,
    input.contactId,
    input.productId,
    input.calendarId,
    input.startTime,
    input.timezone,
    input.participantAgreementVersion || null,
    input.participantAgreementAcceptedAt || null,
    input.participantAgreementIp || null,
    input.participantAgreementUserAgent || null,
    now,
    expiresAt,
    now,
  ).run();
  if (changesOf(inserted) === 1) return { state: "created", intent: { ...input, status: "pending", orderId: null, appointmentId: null, createdAt: now, expiresAt } };

  const row = await db.prepare("SELECT * FROM paid_booking_intents WHERE intent_id = ?")
    .bind(input.intentId)
    .first();
  if (!row || !sameIntent(row, input)) return { state: "conflict", intent: normalize(row) };
  return { state: "existing", intent: normalize(row) };
}

export async function bindPaidBookingIntent(db, input, options = {}) {
  if (!db) throw new Error("ATTEND_DB paid-booking intent state is unavailable");
  if (!input?.orderId || !input?.contactId || !input?.productId) throw new TypeError("order binding identity required");
  const existing = await db.prepare("SELECT * FROM paid_booking_intents WHERE order_id = ?")
    .bind(input.orderId)
    .first();
  if (existing) return { state: "bound", intent: normalize(existing) };

  const now = Number(options.now ?? Date.now());
  const rawOrderAt = input.orderCreatedAt;
  const orderAt = rawOrderAt !== null && rawOrderAt !== undefined && rawOrderAt !== "" && Number.isFinite(Number(rawOrderAt))
    ? Number(rawOrderAt)
    : now;
  const skewMs = Number(options.skewMs ?? 5 * 60 * 1000);
  const result = await db.prepare(
    `SELECT * FROM paid_booking_intents
      WHERE contact_id = ? AND product_id = ? AND status = 'pending'
        AND created_at <= ? AND expires_at >= ?
      ORDER BY created_at DESC LIMIT 3`,
  ).bind(input.contactId, input.productId, orderAt + skewMs, orderAt - skewMs).all();
  const rows = result?.results || [];
  if (rows.length === 0) return { state: "not_found", intent: null };
  if (rows.length > 1) return { state: "ambiguous", intents: rows.map(normalize) };

  const intent = rows[0];
  const updated = await db.prepare(
    `UPDATE paid_booking_intents
        SET status = 'bound', order_id = ?, updated_at = ?
      WHERE intent_id = ? AND status = 'pending' AND order_id IS NULL`,
  ).bind(input.orderId, now, intent.intent_id).run();
  if (changesOf(updated) !== 1) {
    const raced = await db.prepare("SELECT * FROM paid_booking_intents WHERE order_id = ?")
      .bind(input.orderId)
      .first();
    return raced ? { state: "bound", intent: normalize(raced) } : { state: "ambiguous", intents: [normalize(intent)] };
  }
  return { state: "bound", intent: normalize({ ...intent, status: "bound", order_id: input.orderId, updated_at: now }) };
}

export async function completePaidBookingIntent(db, intentId, appointmentId, options = {}) {
  if (!db || !intentId || !appointmentId) throw new TypeError("paid-booking completion identity required");
  const now = Number(options.now ?? Date.now());
  const updated = await db.prepare(
    `UPDATE paid_booking_intents
        SET status = 'completed', appointment_id = ?, updated_at = ?
      WHERE intent_id = ? AND status IN ('bound', 'completed')
        AND (appointment_id IS NULL OR appointment_id = ?)`,
  ).bind(appointmentId, now, intentId, appointmentId).run();
  if (changesOf(updated) !== 1) throw new Error("paid-booking intent completion was not accepted");
  return { ok: true };
}
