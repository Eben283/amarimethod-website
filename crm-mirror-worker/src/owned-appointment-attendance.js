// Provider-neutral Staff attendance/no-show command.
//
// Production callers are pinned to source-level shadow mode. Tests may exercise the
// separately reviewable active implementation, which writes only canonical owned D1
// appointment truth and its immutable evidence. It has no provider, ledger, payment,
// recovery-decision, entitlement, or communication adapter.

export const OWNED_ATTENDANCE_SOURCE_MODE = "shadow";

const REFERENCE = /^[A-Za-z0-9_-]{1,160}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const ACTORS = new Set(["Eben", "Garrett"]);
const TARGET_STATUSES = new Set(["attended", "no_show"]);

export class OwnedAppointmentAttendanceError extends Error {
  constructor(message, code = "owned_attendance_invalid", status = 409) {
    super(message);
    this.name = "OwnedAppointmentAttendanceError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code, status = 409) {
  throw new OwnedAppointmentAttendanceError(message, code, status);
}

function clean(value) {
  return String(value || "").trim();
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalize(input) {
  const appointmentId = clean(input?.appointmentId);
  const contactId = clean(input?.contactId);
  const actor = clean(input?.actor);
  const idempotencyKey = clean(input?.idempotencyKey);
  const targetStatus = clean(input?.targetStatus).toLowerCase();
  const expectedRevision = Number(input?.expectedRevision);
  if (!REFERENCE.test(appointmentId)) fail("exact appointment id required", "invalid_appointment_id", 400);
  if (!REFERENCE.test(contactId)) fail("exact contact id required", "invalid_contact_id", 400);
  if (!ACTORS.has(actor)) fail("recognized Staff actor required", "invalid_actor", 400);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) fail("valid idempotency key required", "invalid_idempotency_key", 400);
  if (!TARGET_STATUSES.has(targetStatus)) fail("attendance target must be attended or no_show", "invalid_target_status", 400);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    fail("exact positive appointment revision required", "invalid_expected_revision", 400);
  }
  return { appointmentId, contactId, actor, idempotencyKey, targetStatus, expectedRevision };
}

async function payloadDigest(command) {
  return sha256([
    "owned-appointment-attendance:v1",
    command.actor,
    command.idempotencyKey,
    command.appointmentId,
    command.contactId,
    command.targetStatus,
    String(command.expectedRevision),
  ].join("\n"));
}

async function commandByKey(db, actor, idempotencyKey) {
  return db.prepare(
    `SELECT command.id, command.appointment_id, command.contact_id, command.actor,
            command.idempotency_key, command.target_status, command.prior_status,
            command.expected_revision, command.result_revision, command.payload_sha256,
            command.outcome, command.state, command.requested_at, command.completed_at,
            appointment.status AS current_status, appointment.revision AS current_revision,
            appointment.authority, appointment.provider_sync_state
       FROM appointment_attendance_commands command
       JOIN appointments appointment ON appointment.id = command.appointment_id
      WHERE command.actor = ? AND command.idempotency_key = ?`,
  ).bind(actor, idempotencyKey).first();
}

async function exactAppointment(db, appointmentId) {
  return db.prepare(
    `SELECT appointment.id, appointment.contact_id, appointment.status,
            appointment.starts_at, appointment.authority,
            appointment.provider_sync_state, appointment.revision,
            contact.archived_at
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
      WHERE appointment.id = ?`,
  ).bind(appointmentId).first();
}

function publicCommand(row, deduped) {
  return Object.freeze({
    commandId: row.id,
    appointmentId: row.appointment_id,
    contactId: row.contact_id,
    actor: row.actor,
    targetStatus: row.target_status,
    priorStatus: row.prior_status,
    expectedRevision: Number(row.expected_revision),
    resultRevision: Number(row.result_revision),
    outcome: row.outcome,
    state: row.state,
    changed: row.outcome === "applied",
    deduped,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    currentStatus: row.current_status,
    currentRevision: Number(row.current_revision),
    authority: row.authority,
    providerSyncState: row.provider_sync_state,
    providerWrite: false,
    sessionLedgerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    authorityPromoted: false,
  });
}

function assertAppointment(row, command, nowMs) {
  if (!row) fail("appointment not found", "appointment_not_found", 404);
  if (row.contact_id !== command.contactId) fail("appointment contact changed", "appointment_contact_mismatch");
  if (Number(row.revision) !== command.expectedRevision) fail("appointment revision changed", "appointment_revision_conflict");
  if (row.archived_at) fail("contact is archived", "contact_archived");
  if (row.authority !== "owned" || row.provider_sync_state !== "not_required") {
    fail("appointment is not provider-free owned authority", "appointment_authority_unavailable");
  }
  if (row.status === "cancelled") fail("cancelled appointment cannot be marked", "appointment_cancelled");
  const startMs = Date.parse(row.starts_at || "");
  if (!Number.isFinite(startMs)) fail("appointment start is unavailable", "appointment_start_unavailable");
  if (command.targetStatus === "no_show" && nowMs < startMs) {
    fail("no-show cannot be recorded before appointment start", "no_show_too_early");
  }
  if (command.targetStatus === "attended" && nowMs < startMs - 2 * 60 * 60 * 1000) {
    fail("attendance cannot be recorded more than two hours before appointment start", "attended_too_early");
  }
}

function mapStorageError(error) {
  const message = String(error?.message || error || "");
  const matches = [
    [/attendance appointment not found/i, "appointment_not_found", 404],
    [/attendance contact mismatch/i, "appointment_contact_mismatch", 409],
    [/attendance revision conflict/i, "appointment_revision_conflict", 409],
    [/attendance authority unavailable/i, "appointment_authority_unavailable", 409],
    [/attendance contact archived/i, "contact_archived", 409],
    [/attendance appointment cancelled/i, "appointment_cancelled", 409],
    [/attendance appointment start unavailable/i, "appointment_start_unavailable", 409],
    [/attendance marking is too early/i, "attended_too_early", 409],
    [/no-show marking is too early/i, "no_show_too_early", 409],
    [/attendance status conflict|attendance outcome conflict/i, "appointment_state_conflict", 409],
  ];
  const mapped = matches.find(([pattern]) => pattern.test(message));
  if (mapped) return new OwnedAppointmentAttendanceError(message, mapped[1], mapped[2]);
  return error;
}

export function ownedAttendanceReleaseReadiness(mode = OWNED_ATTENDANCE_SOURCE_MODE) {
  const sourceMode = mode === "active" ? "active" : "shadow";
  return Object.freeze({
    sourceMode,
    enabled: sourceMode === "active",
    providerFallback: null,
    providerWrite: false,
    sessionLedgerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    authorityPromotion: false,
  });
}

export async function captureOwnedAppointmentAttendance(db, input, now = new Date().toISOString(), options = {}) {
  const readiness = ownedAttendanceReleaseReadiness(options.sourceMode ?? OWNED_ATTENDANCE_SOURCE_MODE);
  if (!readiness.enabled) {
    fail("owned attendance commands remain source-level shadow", "owned_attendance_shadow_only", 503);
  }
  if (!db?.prepare) fail("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) fail("valid command time required", "invalid_command_time", 400);
  const requestedAt = new Date(nowMs).toISOString();
  const command = normalize(input);
  const digest = await payloadDigest(command);
  const keyDigest = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const commandId = `aatcmd_${keyDigest.slice(0, 32)}`;

  const prior = await commandByKey(db, command.actor, command.idempotencyKey);
  if (prior) {
    if (prior.payload_sha256 !== digest) {
      fail("idempotency key was already used for another attendance command", "idempotency_conflict");
    }
    return publicCommand(prior, true);
  }

  const appointment = await exactAppointment(db, command.appointmentId);
  assertAppointment(appointment, command, nowMs);
  const outcome = appointment.status === command.targetStatus ? "no_change" : "applied";
  const resultRevision = command.expectedRevision + (outcome === "applied" ? 1 : 0);

  let inserted;
  try {
    inserted = await db.prepare(
      `INSERT OR IGNORE INTO appointment_attendance_commands (
         id, appointment_id, contact_id, actor, idempotency_key, target_status,
         prior_status, expected_revision, result_revision, payload_sha256,
         outcome, state, requested_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
    ).bind(
      commandId, command.appointmentId, command.contactId, command.actor,
      command.idempotencyKey, command.targetStatus, appointment.status,
      command.expectedRevision, resultRevision, digest, outcome, requestedAt, requestedAt,
    ).run();
  } catch (error) {
    throw mapStorageError(error);
  }

  const captured = await commandByKey(db, command.actor, command.idempotencyKey);
  if (!captured) fail("attendance command was not recorded", "attendance_storage_conflict", 500);
  if (captured.payload_sha256 !== digest) {
    fail("idempotency key was already used for another attendance command", "idempotency_conflict");
  }
  return publicCommand(captured, changes(inserted) === 0);
}
