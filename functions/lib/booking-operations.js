// Durable, leased state for appointment-creation operations.
//
// A KV idempotency value written only after a successful remote call cannot
// close the create -> cache crash window. This D1 state machine claims the
// operation atomically, checkpoints the GHL appointment id immediately after
// creation, and lets a later request resume an expired lease without creating
// another appointment.

function changesOf(result) {
  return result?.meta?.changes ?? result?.changes ?? 0;
}

function normalizeRow(row) {
  if (!row) return null;
  let result = null;
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = null;
    }
  }
  return {
    opKey: row.op_key,
    kind: row.kind,
    contactId: row.contact_id,
    calendarId: row.calendar_id,
    startTime: row.start_time,
    status: row.status,
    appointmentId: row.appointment_id || null,
    result,
    leaseUntil: Number(row.lease_until || 0),
    attempts: Number(row.attempts || 0),
    lastError: row.last_error || null,
  };
}

function sameRequest(row, input) {
  return row.kind === input.kind &&
    row.contact_id === input.contactId &&
    row.calendar_id === input.calendarId &&
    row.start_time === input.startTime;
}

async function readRow(db, opKey) {
  return db.prepare("SELECT * FROM booking_operations WHERE op_key = ?")
    .bind(opKey)
    .first();
}

/**
 * Atomically acquire or resume a booking operation.
 *
 * state is one of: acquired, completed, in_progress, manual_review, conflict.
 */
export async function claimBookingOperation(db, input, options = {}) {
  if (!db) throw new Error("ATTEND_DB booking state is unavailable");
  if (!input?.opKey || !input?.kind || !input?.contactId || !input?.calendarId || !input?.startTime) {
    throw new TypeError("complete booking operation identity required");
  }

  const now = Number(options.now ?? Date.now());
  const leaseMs = Number(options.leaseMs ?? 120_000);
  const leaseUntil = now + leaseMs;
  const insert = await db.prepare(
    `INSERT INTO booking_operations
      (op_key, kind, contact_id, calendar_id, start_time, status,
       appointment_id, result_json, lease_until, attempts, last_error,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'processing', NULL, NULL, ?, 1, NULL, ?, ?)
     ON CONFLICT(op_key) DO NOTHING`,
  ).bind(
    input.opKey,
    input.kind,
    input.contactId,
    input.calendarId,
    input.startTime,
    leaseUntil,
    now,
    now,
  ).run();

  if (changesOf(insert) === 1) {
    return {
      state: "acquired",
      operation: {
        ...input,
        status: "processing",
        appointmentId: null,
        result: null,
        leaseUntil,
        attempts: 1,
        lastError: null,
      },
    };
  }

  let row = await readRow(db, input.opKey);
  if (!row) throw new Error("booking operation disappeared after conflict");
  if (!sameRequest(row, input)) {
    return { state: "conflict", operation: normalizeRow(row) };
  }
  if (row.status === "completed") {
    return { state: "completed", operation: normalizeRow(row) };
  }
  if (row.status === "manual_review") {
    return { state: "manual_review", operation: normalizeRow(row) };
  }
  if (row.status === "processing" && Number(row.lease_until || 0) > now) {
    return { state: "in_progress", operation: normalizeRow(row) };
  }

  const resumed = await db.prepare(
    `UPDATE booking_operations
        SET status = 'processing', lease_until = ?, attempts = attempts + 1,
            last_error = NULL, updated_at = ?
      WHERE op_key = ?
        AND status IN ('processing', 'retryable')
        AND lease_until <= ?`,
  ).bind(leaseUntil, now, input.opKey, now).run();
  if (changesOf(resumed) === 1) {
    row = await readRow(db, input.opKey);
    return { state: "acquired", operation: normalizeRow(row) };
  }

  row = await readRow(db, input.opKey);
  if (row?.status === "completed") return { state: "completed", operation: normalizeRow(row) };
  if (row?.status === "manual_review") return { state: "manual_review", operation: normalizeRow(row) };
  return { state: "in_progress", operation: normalizeRow(row) };
}

function sameCreateAttempt(attempt, details) {
  return Boolean(attempt) &&
    attempt.kind === details.kind &&
    attempt.contactId === details.contactId &&
    attempt.calendarId === details.calendarId &&
    attempt.startTime === details.startTime;
}

export async function checkpointBookingCreateAttempt(db, opKey, details, options = {}) {
  if (!db || !opKey || !details?.kind || !details?.contactId ||
      !details?.calendarId || !details?.startTime) {
    throw new TypeError("booking create-attempt identity required");
  }

  const row = await readRow(db, opKey);
  if (!row || row.status !== "processing" || row.appointment_id ||
      row.kind !== details.kind || row.contact_id !== details.contactId ||
      row.calendar_id !== details.calendarId || row.start_time !== details.startTime) {
    throw new Error("booking create-attempt checkpoint was not accepted");
  }

  const priorResult = normalizeRow(row).result;
  if (priorResult && !sameCreateAttempt(priorResult.createAttempt, details)) {
    throw new Error("booking create-attempt provenance conflicts with the operation");
  }

  const now = Number(options.now ?? Date.now());
  const leaseUntil = now + Number(options.leaseMs ?? 120_000);
  const createAttempt = priorResult?.createAttempt || {
    at: now,
    kind: details.kind,
    contactId: details.contactId,
    calendarId: details.calendarId,
    startTime: details.startTime,
  };
  const result = { ...(priorResult || {}), createAttempt };
  const updated = await db.prepare(
    `UPDATE booking_operations
        SET result_json = ?, lease_until = ?, updated_at = ?
      WHERE op_key = ? AND status = 'processing' AND appointment_id IS NULL
        AND kind = ? AND contact_id = ? AND calendar_id = ? AND start_time = ?`,
  ).bind(
    JSON.stringify(result),
    leaseUntil,
    now,
    opKey,
    details.kind,
    details.contactId,
    details.calendarId,
    details.startTime,
  ).run();
  if (changesOf(updated) !== 1) {
    throw new Error("booking create-attempt checkpoint was not accepted");
  }
  return { ok: true, createAttempt };
}

export async function checkpointBookingAppointment(db, opKey, appointmentId, options = {}) {
  if (!db || !opKey || !appointmentId) throw new TypeError("booking checkpoint identity required");
  const now = Number(options.now ?? Date.now());
  const leaseUntil = now + Number(options.leaseMs ?? 120_000);
  const updated = await db.prepare(
    `UPDATE booking_operations
        SET appointment_id = ?, lease_until = ?, updated_at = ?
      WHERE op_key = ? AND status = 'processing'
        AND (appointment_id IS NULL OR appointment_id = ?)`,
  ).bind(appointmentId, leaseUntil, now, opKey, appointmentId).run();
  if (changesOf(updated) !== 1) {
    throw new Error("booking appointment checkpoint was not accepted");
  }
  return { ok: true };
}

export async function clearBookingAppointmentCheckpoint(db, opKey, appointmentId, options = {}) {
  if (!db || !opKey || !appointmentId) throw new TypeError("booking checkpoint identity required");
  const now = Number(options.now ?? Date.now());
  const updated = await db.prepare(
    `UPDATE booking_operations
        SET appointment_id = NULL, updated_at = ?
      WHERE op_key = ? AND status = 'processing' AND appointment_id = ?`,
  ).bind(now, opKey, appointmentId).run();
  if (changesOf(updated) !== 1) throw new Error("booking appointment checkpoint could not be cleared");
  return { ok: true };
}

export async function completeBookingOperation(db, opKey, result, options = {}) {
  if (!db || !opKey) throw new TypeError("booking completion identity required");
  const now = Number(options.now ?? Date.now());
  const updated = await db.prepare(
    `UPDATE booking_operations
        SET status = 'completed', result_json = ?, lease_until = 0,
            last_error = NULL, updated_at = ?
      WHERE op_key = ? AND status = 'processing'`,
  ).bind(JSON.stringify(result), now, opKey).run();
  if (changesOf(updated) !== 1) throw new Error("booking completion was not accepted");
  return { ok: true };
}

export async function failBookingOperation(db, opKey, error, options = {}) {
  if (!db || !opKey) return null;
  const now = Number(options.now ?? Date.now());
  const status = options.manualReview ? "manual_review" : "retryable";
  const updated = await db.prepare(
    `UPDATE booking_operations
        SET status = ?, lease_until = 0, last_error = ?, updated_at = ?
      WHERE op_key = ? AND status = 'processing'`,
  ).bind(status, String(error || "unknown error").slice(0, 1000), now, opKey).run();
  return { ok: changesOf(updated) === 1, status };
}
