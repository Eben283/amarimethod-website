const REFERENCE = /^[A-Za-z0-9_-]{1,160}$/;
const RECOVERABLE_AUTHORITY = new Set(["owned", "provider_mirror"]);
const RECOVERABLE_SYNC = new Set(["synced", "not_required"]);

export class AppointmentRecoveryRequestError extends Error {
  constructor(message, code = "appointment_recovery_request_invalid", status = 409) {
    super(message);
    this.name = "AppointmentRecoveryRequestError";
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value || "").trim();

function fail(message, code, status = 409) {
  throw new AppointmentRecoveryRequestError(message, code, status);
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestDigest(appointmentId, contactId, revision) {
  return hex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`appointment-recovery-request:v1\n${appointmentId}\n${contactId}\n${revision}`),
  ));
}

function publicRequest(row) {
  return Object.freeze({
    requestId: row.id,
    appointmentId: row.appointment_id,
    contactId: row.contact_id,
    appointmentRevision: Number(row.appointment_revision),
    state: row.state,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    ...(row.display_name === undefined ? {} : {
      contactName: row.display_name || "Unknown",
      serviceName: row.service_name || "Session",
      startsAt: row.starts_at || null,
      timezone: row.timezone || "America/Los_Angeles",
    }),
  });
}

async function exactMissedAppointment(db, appointmentId) {
  return db.prepare(
    `SELECT appointment.id, appointment.contact_id, appointment.service_id,
            appointment.status, appointment.authority,
            appointment.provider_sync_state, appointment.revision,
            contact.archived_at
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
      WHERE appointment.id = ?`,
  ).bind(appointmentId).first();
}

function assertRecoverable(row, contactId, revision) {
  if (!row) fail("missed appointment not found", "appointment_recovery_not_found", 404);
  if (row.contact_id !== contactId || Number(row.revision) !== revision) {
    fail("appointment recovery identity changed", "appointment_recovery_identity_mismatch");
  }
  if (row.archived_at) fail("contact is archived", "appointment_recovery_contact_archived");
  if (clean(row.status).toLowerCase() !== "no_show") {
    fail("appointment is not recorded as missed", "appointment_recovery_not_missed");
  }
  if (!clean(row.service_id)) fail("appointment service is unavailable", "appointment_recovery_service_unavailable");
  if (!RECOVERABLE_AUTHORITY.has(clean(row.authority)) || !RECOVERABLE_SYNC.has(clean(row.provider_sync_state))) {
    fail("appointment authority is not ready", "appointment_recovery_authority_unavailable");
  }
}

export async function captureAppointmentRecoveryRequest(db, input, now = new Date().toISOString()) {
  if (!db?.prepare || !db?.batch) fail("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const appointmentId = clean(input?.appointmentId);
  const contactId = clean(input?.contactId);
  const revision = Number(input?.appointmentRevision);
  if (!REFERENCE.test(appointmentId) || !REFERENCE.test(contactId) || !Number.isInteger(revision) || revision < 1) {
    fail("exact appointment recovery identity required", "appointment_recovery_identity_required", 400);
  }
  const row = await exactMissedAppointment(db, appointmentId);
  assertRecoverable(row, contactId, revision);
  const digest = await requestDigest(appointmentId, contactId, revision);
  const requestId = `recovery_${digest.slice(0, 48)}`;
  const eventId = `recovery_event_${digest.slice(0, 48)}`;
  const detail = JSON.stringify({ source: "signed_appointment_manage_link", appointmentRevision: revision });
  const [inserted] = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO appointment_recovery_requests
         (id, appointment_id, contact_id, appointment_revision, request_sha256,
          state, requested_at, reviewed_at, reviewed_by, updated_at)
       SELECT ?, appointment.id, appointment.contact_id, appointment.revision, ?,
              'pending_review', ?, NULL, NULL, ?
         FROM appointments appointment
         JOIN contacts contact ON contact.id = appointment.contact_id
        WHERE appointment.id = ? AND appointment.contact_id = ?
          AND appointment.revision = ? AND appointment.status = 'no_show'
          AND appointment.service_id IS NOT NULL AND contact.archived_at IS NULL
          AND appointment.authority IN ('owned', 'provider_mirror')
          AND appointment.provider_sync_state IN ('synced', 'not_required')`,
    ).bind(requestId, digest, now, now, appointmentId, contactId, revision),
    db.prepare(
      `INSERT OR IGNORE INTO appointment_recovery_request_events
         (id, request_id, event_type, detail_json, occurred_at)
       SELECT ?, id, 'client_requested', ?, ?
         FROM appointment_recovery_requests
        WHERE id = ?`,
    ).bind(eventId, detail, now, requestId),
  ]);
  const captured = await db.prepare(
    `SELECT id, appointment_id, contact_id, appointment_revision, state,
            requested_at, reviewed_at, reviewed_by
       FROM appointment_recovery_requests WHERE id = ?`,
  ).bind(requestId).first();
  if (!captured) fail("appointment changed before request capture", "appointment_recovery_capture_conflict");
  return Object.freeze({ ...publicRequest(captured), deduped: Number(inserted?.meta?.changes || 0) === 0 });
}

export async function listAppointmentRecoveryRequests(db, { state = "pending_review", limit = 50 } = {}) {
  if (!db?.prepare) fail("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const normalizedState = state === "all" ? "all" : "pending_review";
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const result = await db.prepare(
    `SELECT request.id, request.appointment_id, request.contact_id,
            request.appointment_revision, request.state, request.requested_at,
            request.reviewed_at, request.reviewed_by,
            contact.display_name, service.name AS service_name,
            appointment.starts_at, appointment.timezone
       FROM appointment_recovery_requests request
       JOIN appointments appointment ON appointment.id = request.appointment_id
       JOIN contacts contact ON contact.id = request.contact_id
       LEFT JOIN services service ON service.id = appointment.service_id
      WHERE (? = 'all' OR request.state = ?)
      ORDER BY CASE WHEN request.state = 'pending_review' THEN 0 ELSE 1 END,
               datetime(request.requested_at), request.id
      LIMIT ?`,
  ).bind(normalizedState, normalizedState, normalizedLimit).all();
  return (result?.results || []).map(publicRequest);
}
