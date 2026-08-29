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
