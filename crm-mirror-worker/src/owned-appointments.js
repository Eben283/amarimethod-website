// Provider-neutral appointment authority for Staff.
//
// This module accepts only owned contact/service identity. It atomically
// records a canonical appointment plus an idempotent command and append-only
// acceptance evidence. Provider propagation is deliberately a later executor
// step; capture itself can neither call nor silently fall back to GHL.

const CONTACT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SERVICE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const STAFF_ACTOR = /^[A-Za-z][A-Za-z .'-]{0,78}$/;
const MAX_FUTURE_MS = 33 * 86_400_000;

export class OwnedAppointmentError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "OwnedAppointmentError";
    this.code = code;
    this.status = status;
  }
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeSchedule(input, nowMs) {
  const contactId = clean(input?.contactId, 100);
  const serviceId = clean(input?.serviceId, 100);
  const actor = clean(input?.actor, 80);
  const idempotencyKey = clean(input?.idempotencyKey, 160);
  const timezone = clean(input?.timezone, 100);
  const startMs = Date.parse(input?.startTime || "");
  if (!CONTACT_ID.test(contactId)) throw new OwnedAppointmentError("invalid contactId", "invalid_contact", 400);
  if (!SERVICE_ID.test(serviceId)) throw new OwnedAppointmentError("invalid serviceId", "invalid_service", 400);
  if (!STAFF_ACTOR.test(actor)) throw new OwnedAppointmentError("invalid staff actor", "invalid_actor", 400);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new OwnedAppointmentError("invalid idempotencyKey", "invalid_idempotency_key", 400);
  if (!timezone || timezone.length > 100) throw new OwnedAppointmentError("invalid timezone", "invalid_timezone", 400);
  if (!Number.isFinite(startMs) || startMs <= nowMs || startMs > nowMs + MAX_FUTURE_MS) {
    throw new OwnedAppointmentError("appointment time must be in the next 33 days", "invalid_start_time", 400);
  }
  return { contactId, serviceId, actor, idempotencyKey, timezone, startMs };
}

function publicAppointment(row, deduped) {
  return {
    commandId: row.command_id,
    appointmentId: row.id,
    contactId: row.contact_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    authority: row.authority,
    revision: Number(row.revision),
    providerSyncState: row.provider_sync_state,
    commandState: row.command_state,
    deduped,
  };
}

function publicExecution(row) {
  if (!row) return null;
  let result = null;
  try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch { result = null; }
  return {
    commandId: row.id,
    actor: row.actor,
    action: row.action,
    contactId: row.contact_id,
    appointmentId: row.appointment_id,
    serviceId: row.service_id,
    state: row.state,
    provider: row.provider || null,
    providerRecordId: row.provider_record_id || null,
    attempts: Number(row.attempts || 0),
    leaseUntil: Number(row.lease_until || 0),
    result,
    lastError: row.last_error || null,
  };
}

async function executionById(db, commandId) {
  return db.prepare("SELECT * FROM appointment_authority_commands WHERE id = ?")
    .bind(commandId).first();
}

function commandIdentity(commandId, actor) {
  const id = clean(commandId, 100);
  const staffActor = clean(actor, 80);
  if (!/^acmd_[a-f0-9]{24}$/.test(id)) throw new OwnedAppointmentError("invalid commandId", "invalid_command", 400);
  if (!STAFF_ACTOR.test(staffActor)) throw new OwnedAppointmentError("invalid staff actor", "invalid_actor", 400);
  return { commandId: id, actor: staffActor };
}

async function commandByKey(db, actor, idempotencyKey) {
  return db.prepare(
    `SELECT command.id AS command_id, command.payload_sha256, command.state AS command_state,
            appointment.id, appointment.contact_id, appointment.service_id,
            service.name AS service_name, appointment.status, appointment.starts_at,
            appointment.ends_at, appointment.timezone, appointment.authority,
            appointment.revision, appointment.provider_sync_state
       FROM appointment_authority_commands command
       JOIN appointments appointment ON appointment.id = command.appointment_id
       LEFT JOIN services service ON service.id = appointment.service_id
      WHERE command.actor = ? AND command.idempotency_key = ?`,
  ).bind(actor, idempotencyKey).first();
}

/**
 * Capture a native schedule decision. `providerSyncRequired` is a server-owned
 * deployment choice, never a browser field.
 */
export async function captureOwnedScheduleCommand(db, input, options = {}) {
  if (!db) throw new OwnedAppointmentError("appointment storage is unavailable", "storage_unavailable", 500);
  const nowMs = Number(options.nowMs ?? Date.now());
  const now = new Date(nowMs).toISOString();
  const command = normalizeSchedule(input, nowMs);
  const providerSyncState = options.providerSyncRequired === false ? "not_required" : "pending";
  const keyDigest = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const payloadHash = await sha256(JSON.stringify({
    action: "schedule",
    contactId: command.contactId,
    serviceId: command.serviceId,
    startTime: new Date(command.startMs).toISOString(),
    timezone: command.timezone,
    providerSyncState,
  }));
  const commandId = `acmd_${keyDigest.slice(0, 24)}`;
  const appointmentId = `appt_${keyDigest.slice(0, 24)}`;
  const eventId = `aevt_${keyDigest.slice(0, 24)}_accepted`;

  const prior = await commandByKey(db, command.actor, command.idempotencyKey);
  if (prior) {
    if (prior.payload_sha256 !== payloadHash) {
      throw new OwnedAppointmentError("idempotency key was already used for another appointment", "idempotency_conflict", 409);
    }
    return publicAppointment(prior, true);
  }

  const contact = await db.prepare("SELECT id FROM contacts WHERE id = ? AND archived_at IS NULL")
    .bind(command.contactId).first();
  if (!contact) throw new OwnedAppointmentError("contact not found", "contact_not_found", 404);
  const service = await db.prepare(
    `SELECT id, name, duration_minutes, buffer_minutes
       FROM services WHERE id = ? AND active = 1`,
  ).bind(command.serviceId).first();
  const durationMinutes = Number(service?.duration_minutes);
  const bufferMinutes = Number(service?.buffer_minutes);
  if (!service || !Number.isInteger(durationMinutes) || durationMinutes <= 0 ||
      !Number.isInteger(bufferMinutes) || bufferMinutes < 0) {
    throw new OwnedAppointmentError("service is not schedulable", "service_not_schedulable", 409);
  }
  const startsAt = new Date(command.startMs).toISOString();
  const endsAt = new Date(command.startMs + durationMinutes * 60_000).toISOString();
  const occupiedUntil = new Date(command.startMs + (durationMinutes + bufferMinutes) * 60_000).toISOString();

  const results = await db.batch([
    db.prepare(
      `INSERT INTO appointments (
         id, contact_id, service_id, status, starts_at, ends_at, timezone,
         authority, provider_sync_state, revision, created_by, last_modified_by,
         created_at, updated_at
       )
       SELECT ?, ?, ?, 'confirmed', ?, ?, ?, 'owned', ?, 1, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
            FROM appointments existing
            LEFT JOIN services existing_service ON existing_service.id = existing.service_id
           WHERE existing.status IN ('booked', 'confirmed', 'unknown')
             AND existing.starts_at IS NOT NULL
             AND datetime(existing.starts_at) < datetime(?)
             AND datetime(COALESCE(existing.ends_at, existing.starts_at),
                          '+' || COALESCE(existing_service.buffer_minutes, 0) || ' minutes') > datetime(?)
        )`,
    ).bind(
      appointmentId, command.contactId, command.serviceId, startsAt, endsAt,
      command.timezone, providerSyncState, command.actor, command.actor, now, now,
      occupiedUntil, startsAt,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO appointment_authority_commands (
         id, actor, idempotency_key, action, contact_id, appointment_id,
         source_appointment_id, service_id, requested_start_time,
         requested_end_time, requested_timezone, payload_sha256, state,
         provider, provider_record_id, attempts, lease_until, result_json,
         last_error, created_at, updated_at
       )
       SELECT ?, ?, ?, 'schedule', ?, ?, NULL, ?, ?, ?, ?, ?, 'accepted',
              NULL, NULL, 0, 0, NULL, NULL, ?, ?
        WHERE EXISTS (SELECT 1 FROM appointments WHERE id = ?)`,
    ).bind(
      commandId, command.actor, command.idempotencyKey, command.contactId,
      appointmentId, command.serviceId, startsAt, endsAt, command.timezone,
      payloadHash, now, now, appointmentId,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO appointment_authority_events
         (id, command_id, appointment_id, event_type, detail_json, occurred_at)
       SELECT ?, ?, ?, 'accepted', ?, ?
        WHERE EXISTS (SELECT 1 FROM appointment_authority_commands WHERE id = ?)`,
    ).bind(
      eventId, commandId, appointmentId,
      JSON.stringify({ providerSyncState, serviceId: command.serviceId }), now,
      commandId,
    ),
  ]);

  const stored = await commandByKey(db, command.actor, command.idempotencyKey);
  if (!stored) {
    if (changes(results?.[0]) === 0) {
      throw new OwnedAppointmentError("that time is no longer open on the owned schedule", "slot_unavailable", 409);
    }
    throw new OwnedAppointmentError("appointment command was not recorded", "storage_failure", 500);
  }
  if (stored.payload_sha256 !== payloadHash) {
    throw new OwnedAppointmentError("idempotency key was already used for another appointment", "idempotency_conflict", 409);
  }
  return publicAppointment(stored, changes(results?.[0]) === 0);
}

export async function claimOwnedAppointmentExecution(db, input, options = {}) {
  if (!db) throw new OwnedAppointmentError("appointment storage is unavailable", "storage_unavailable", 500);
  const identity = commandIdentity(input?.commandId, input?.actor);
  const nowMs = Number(options.nowMs ?? Date.now());
  const leaseUntil = nowMs + Number(options.leaseMs ?? 120_000);
  let row = await executionById(db, identity.commandId);
  if (!row || row.actor !== identity.actor) throw new OwnedAppointmentError("appointment command not found", "command_not_found", 404);
  if (row.state === "completed") return { state: "completed", execution: publicExecution(row) };
  if (row.state === "manual_review") return { state: "manual_review", execution: publicExecution(row) };
  if (row.state === "rejected") return { state: "rejected", execution: publicExecution(row) };
  if (row.state === "executing" && Number(row.lease_until) > nowMs) {
    return { state: "in_progress", execution: publicExecution(row) };
  }
  const updated = await db.prepare(
    `UPDATE appointment_authority_commands
        SET state = 'executing', attempts = attempts + 1, lease_until = ?,
            last_error = NULL, updated_at = ?
      WHERE id = ? AND actor = ?
        AND (state IN ('accepted', 'retryable') OR (state = 'executing' AND lease_until <= ?))`,
  ).bind(leaseUntil, new Date(nowMs).toISOString(), identity.commandId, identity.actor, nowMs).run();
  if (changes(updated) !== 1) {
    row = await executionById(db, identity.commandId);
    return {
      state: row?.state === "completed" ? "completed"
        : row?.state === "manual_review" ? "manual_review"
          : row?.state === "rejected" ? "rejected" : "in_progress",
      execution: publicExecution(row),
    };
  }
  row = await executionById(db, identity.commandId);
  await db.prepare(
    `INSERT INTO appointment_authority_events
       (id, command_id, appointment_id, event_type, detail_json, occurred_at)
     VALUES (?, ?, ?, 'execution_claimed', ?, ?)`,
  ).bind(
    crypto.randomUUID(), row.id, row.appointment_id,
    JSON.stringify({ attempt: Number(row.attempts), leaseUntil }), new Date(nowMs).toISOString(),
  ).run();
  return { state: "acquired", execution: publicExecution(row) };
}

export async function linkOwnedAppointmentProviderRecord(db, input, options = {}) {
  if (!db) throw new OwnedAppointmentError("appointment storage is unavailable", "storage_unavailable", 500);
  const identity = commandIdentity(input?.commandId, input?.actor);
  const provider = clean(input?.provider, 40);
  const providerRecordId = clean(input?.providerRecordId, 160);
  const providerCalendarId = clean(input?.providerCalendarId, 160) || null;
  const providerStatusRaw = clean(input?.providerStatusRaw, 80) || null;
  if (provider !== "ghl" || !providerRecordId) {
    throw new OwnedAppointmentError("invalid provider appointment link", "invalid_provider_link", 400);
  }
  const now = new Date(Number(options.nowMs ?? Date.now())).toISOString();
  const row = await executionById(db, identity.commandId);
  if (!row || row.actor !== identity.actor) throw new OwnedAppointmentError("appointment command not found", "command_not_found", 404);
  if (row.state !== "executing") throw new OwnedAppointmentError("appointment command is not executing", "command_not_executing", 409);
  if (row.provider_record_id && (row.provider !== provider || row.provider_record_id !== providerRecordId)) {
    throw new OwnedAppointmentError("appointment command is linked to another provider record", "provider_link_conflict", 409);
  }
  const appointment = await db.prepare(
    "SELECT authority, provider_appointment_id FROM appointments WHERE id = ?",
  ).bind(row.appointment_id).first();
  if (!appointment || appointment.authority !== "owned" ||
      (appointment.provider_appointment_id && appointment.provider_appointment_id !== providerRecordId)) {
    throw new OwnedAppointmentError("owned appointment has another provider record", "provider_link_conflict", 409);
  }
  const existing = await db.prepare(
    `SELECT record_id FROM external_records
      WHERE provider = ? AND object_type = 'appointment' AND external_id = ?`,
  ).bind(provider, providerRecordId).first();
  if (existing && existing.record_id !== row.appointment_id) {
    throw new OwnedAppointmentError("provider appointment belongs to another owned record", "provider_link_conflict", 409);
  }
  const linkDigest = await sha256(`${provider}\n${providerRecordId}`);
  try {
    await db.batch([
      db.prepare(
        `UPDATE appointment_authority_commands
            SET provider = ?, provider_record_id = ?, updated_at = ?
          WHERE id = ? AND actor = ? AND state = 'executing'
            AND (provider_record_id IS NULL OR provider_record_id = ?)`,
      ).bind(provider, providerRecordId, now, row.id, identity.actor, providerRecordId),
      db.prepare(
        `UPDATE appointments
            SET provider_appointment_id = ?, provider_calendar_id = ?,
                provider_status_raw = ?, provider_sync_state = 'pending',
                last_modified_by = ?, updated_at = ?
          WHERE id = ? AND authority = 'owned'
            AND (provider_appointment_id IS NULL OR provider_appointment_id = ?)
            AND EXISTS (
              SELECT 1 FROM appointment_authority_commands
               WHERE id = ? AND state = 'executing' AND provider = ? AND provider_record_id = ?
            )`,
      ).bind(
        providerRecordId, providerCalendarId, providerStatusRaw, identity.actor, now,
        row.appointment_id, providerRecordId, row.id, provider, providerRecordId,
      ),
      db.prepare(
        `INSERT INTO external_records
           (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
         SELECT ?, ?, 'appointment', ?, ?, 'appointment', ?, ?
          WHERE EXISTS (
            SELECT 1 FROM appointment_authority_commands
             WHERE id = ? AND state = 'executing' AND provider = ? AND provider_record_id = ?
          )
         ON CONFLICT(provider, object_type, external_id) DO UPDATE SET
           contact_id = excluded.contact_id, record_id = excluded.record_id, last_seen_at = excluded.last_seen_at`,
      ).bind(
        `ext_${linkDigest.slice(0, 24)}`, provider, providerRecordId, row.contact_id,
        row.appointment_id, now, row.id, provider, providerRecordId,
      ),
      db.prepare(
        `INSERT INTO appointment_authority_events
           (id, command_id, appointment_id, event_type, detail_json, occurred_at)
         VALUES (?, ?, ?, 'provider_linked', ?, ?)`,
      ).bind(crypto.randomUUID(), row.id, row.appointment_id, JSON.stringify({ provider, providerRecordId }), now),
    ]);
  } catch (error) {
    throw new OwnedAppointmentError("provider appointment link was not recorded", "provider_link_conflict", 409);
  }
  const linked = await executionById(db, row.id);
  const linkedAppointment = await db.prepare(
    "SELECT provider_appointment_id FROM appointments WHERE id = ?",
  ).bind(row.appointment_id).first();
  if (linked?.provider_record_id !== providerRecordId || linkedAppointment?.provider_appointment_id !== providerRecordId) {
    throw new OwnedAppointmentError("provider appointment link was not recorded", "provider_link_conflict", 409);
  }
  return publicExecution(linked);
}

export async function unlinkOwnedAppointmentProviderRecord(db, input, options = {}) {
  if (!db) throw new OwnedAppointmentError("appointment storage is unavailable", "storage_unavailable", 500);
  const identity = commandIdentity(input?.commandId, input?.actor);
  const providerRecordId = clean(input?.providerRecordId, 160);
  const row = await executionById(db, identity.commandId);
  if (!row || row.actor !== identity.actor) throw new OwnedAppointmentError("appointment command not found", "command_not_found", 404);
  if (row.state !== "executing" || !providerRecordId || row.provider_record_id !== providerRecordId) {
    throw new OwnedAppointmentError("exact provider link is not removable", "provider_unlink_conflict", 409);
  }
  const now = new Date(Number(options.nowMs ?? Date.now())).toISOString();
  await db.batch([
    db.prepare(
      `DELETE FROM external_records
        WHERE provider = ? AND object_type = 'appointment' AND external_id = ? AND record_id = ?`,
    ).bind(row.provider, providerRecordId, row.appointment_id),
    db.prepare(
      `UPDATE appointments
          SET provider_appointment_id = NULL, provider_calendar_id = NULL,
              provider_status_raw = NULL, provider_sync_state = 'pending',
              last_modified_by = ?, updated_at = ?
        WHERE id = ? AND authority = 'owned' AND provider_appointment_id = ?`,
    ).bind(identity.actor, now, row.appointment_id, providerRecordId),
    db.prepare(
      `UPDATE appointment_authority_commands
          SET provider = NULL, provider_record_id = NULL, updated_at = ?
        WHERE id = ? AND actor = ? AND state = 'executing' AND provider_record_id = ?`,
    ).bind(now, row.id, identity.actor, providerRecordId),
    db.prepare(
      `INSERT INTO appointment_authority_events
         (id, command_id, appointment_id, event_type, detail_json, occurred_at)
       VALUES (?, ?, ?, 'provider_unlinked', ?, ?)`,
    ).bind(crypto.randomUUID(), row.id, row.appointment_id, JSON.stringify({ provider: row.provider, providerRecordId }), now),
  ]);
  return publicExecution(await executionById(db, row.id));
}

export async function completeOwnedAppointmentExecution(db, input, options = {}) {
  if (!db) throw new OwnedAppointmentError("appointment storage is unavailable", "storage_unavailable", 500);
  const identity = commandIdentity(input?.commandId, input?.actor);
  const row = await executionById(db, identity.commandId);
  if (!row || row.actor !== identity.actor) throw new OwnedAppointmentError("appointment command not found", "command_not_found", 404);
  if (row.state === "completed") return publicExecution(row);
  if (row.state !== "executing") throw new OwnedAppointmentError("appointment command is not executing", "command_not_executing", 409);
  if (options.providerSyncRequired !== false && !row.provider_record_id) {
    throw new OwnedAppointmentError("provider appointment link is not checkpointed", "provider_link_missing", 409);
  }
  const now = new Date(Number(options.nowMs ?? Date.now())).toISOString();
  const result = input?.result && typeof input.result === "object" && !Array.isArray(input.result) ? input.result : {};
  await db.batch([
    db.prepare(
      `UPDATE appointments
          SET provider_sync_state = ?, updated_at = ?, last_modified_by = ?
        WHERE id = ? AND authority = 'owned'`,
    ).bind(options.providerSyncRequired === false ? "not_required" : "synced", now, identity.actor, row.appointment_id),
    db.prepare(
      `UPDATE appointment_authority_commands
          SET state = 'completed', result_json = ?, lease_until = 0,
              last_error = NULL, updated_at = ?
        WHERE id = ? AND actor = ? AND state = 'executing'`,
    ).bind(JSON.stringify(result), now, row.id, identity.actor),
    db.prepare(
      `INSERT INTO appointment_authority_events
         (id, command_id, appointment_id, event_type, detail_json, occurred_at)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
    ).bind(crypto.randomUUID(), row.id, row.appointment_id, JSON.stringify({ provider: row.provider || null }), now),
  ]);
  return publicExecution(await executionById(db, row.id));
}

export async function failOwnedAppointmentExecution(db, input, options = {}) {
  if (!db) throw new OwnedAppointmentError("appointment storage is unavailable", "storage_unavailable", 500);
  const identity = commandIdentity(input?.commandId, input?.actor);
  const row = await executionById(db, identity.commandId);
  if (!row || row.actor !== identity.actor) throw new OwnedAppointmentError("appointment command not found", "command_not_found", 404);
  if (row.state !== "executing") return publicExecution(row);
  const terminal = input?.terminal === true && !row.provider_record_id;
  const state = terminal ? "rejected" : input?.manualReview ? "manual_review" : "retryable";
  const error = clean(input?.error, 1000) || "appointment execution failed";
  const now = new Date(Number(options.nowMs ?? Date.now())).toISOString();
  await db.batch([
    terminal
      ? db.prepare(
        `UPDATE appointments
            SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?,
                provider_sync_state = 'not_required', updated_at = ?, last_modified_by = ?
          WHERE id = ? AND authority = 'owned'`,
      ).bind(now, error, now, identity.actor, row.appointment_id)
      : db.prepare(
        `UPDATE appointments SET provider_sync_state = ?, updated_at = ?, last_modified_by = ?
          WHERE id = ? AND authority = 'owned'`,
      ).bind(state, now, identity.actor, row.appointment_id),
    db.prepare(
      `UPDATE appointment_authority_commands
          SET state = ?, lease_until = 0, last_error = ?, updated_at = ?
        WHERE id = ? AND actor = ? AND state = 'executing'`,
    ).bind(state, error, now, row.id, identity.actor),
    db.prepare(
      `INSERT INTO appointment_authority_events
         (id, command_id, appointment_id, event_type, detail_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), row.id, row.appointment_id, state, JSON.stringify({ error }), now),
  ]);
  return publicExecution(await executionById(db, row.id));
}
