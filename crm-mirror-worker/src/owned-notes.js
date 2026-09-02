// Provider-neutral revisioned Staff notes.
//
// The production command route is pinned to source-level shadow. Tests may exercise the
// separately reviewable active store, which writes only immutable D1 note versions. It has no
// GHL/provider adapter, message sender, payment, appointment mutation, or authority promotion.

export const OWNED_NOTE_SOURCE_MODE = "shadow";
export const OWNED_NOTE_CONTRACT_VERSION = "owned-note-authority.v1";

const REFERENCE = /^[A-Za-z0-9_-]{1,160}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const ACTIONS = new Set(["create", "revise", "archive", "restore"]);
const ACTORS = new Set(["Eben", "Garrett"]);
const MAX_BODY_LENGTH = 5000;

export class OwnedNoteError extends Error {
  constructor(message, code = "owned_note_invalid", status = 409) {
    super(message);
    this.name = "OwnedNoteError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code, status = 409) {
  throw new OwnedNoteError(message, code, status);
}

function clean(value) {
  return String(value || "").trim();
}

function normalizedBody(value) {
  const body = typeof value === "string" ? value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim() : "";
  if (!body) fail("note body required", "invalid_note_body", 400);
  if (body.length > MAX_BODY_LENGTH) fail(`note body must be ${MAX_BODY_LENGTH} characters or fewer`, "invalid_note_body", 400);
  return body;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalize(input) {
  const action = clean(input?.action).toLowerCase();
  const contactId = clean(input?.contactId);
  const appointmentId = clean(input?.appointmentId) || null;
  const actor = clean(input?.actor);
  const idempotencyKey = clean(input?.idempotencyKey);
  const noteId = clean(input?.noteId) || null;
  const expectedRevision = input?.expectedRevision == null ? 0 : Number(input.expectedRevision);
  if (!ACTIONS.has(action)) fail("recognized note action required", "invalid_note_action", 400);
  if (!REFERENCE.test(contactId)) fail("exact contact id required", "invalid_contact_id", 400);
  if (appointmentId && !REFERENCE.test(appointmentId)) fail("valid appointment id required", "invalid_appointment_id", 400);
  if (!ACTORS.has(actor)) fail("recognized Staff actor required", "invalid_actor", 400);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) fail("valid idempotency key required", "invalid_idempotency_key", 400);
  if (action === "create") {
    if (noteId || expectedRevision !== 0) fail("create cannot supply note identity or revision", "invalid_note_create", 400);
  } else if (!noteId || !REFERENCE.test(noteId) || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    fail("exact note identity and revision required", "invalid_note_identity", 400);
  }
  const body = action === "create" || action === "revise" ? normalizedBody(input?.body) : null;
  return { action, contactId, appointmentId, actor, idempotencyKey, noteId, expectedRevision, body };
}

async function commandDigest(command) {
  return sha256([
    OWNED_NOTE_CONTRACT_VERSION,
    command.actor,
    command.idempotencyKey,
    command.action,
    command.contactId,
    command.appointmentId || "",
    command.noteId || "",
    String(command.expectedRevision),
    command.body || "",
  ].join("\n"));
}

async function versionByKey(db, actor, idempotencyKey) {
  return db.prepare(
    `SELECT * FROM owned_note_versions
      WHERE actor = ? AND idempotency_key = ?`,
  ).bind(actor, idempotencyKey).first();
}

async function latestVersion(db, noteId) {
  return db.prepare(
    `SELECT * FROM owned_note_versions
      WHERE note_id = ? ORDER BY revision DESC LIMIT 1`,
  ).bind(noteId).first();
}

function publicVersion(row, deduped) {
  return Object.freeze({
    versionId: row.id,
    noteId: row.note_id,
    contactId: row.contact_id,
    appointmentId: row.appointment_id || null,
    actor: row.actor,
    action: row.action,
    revision: Number(row.revision),
    priorRevision: Number(row.prior_revision),
    body: row.body_clean,
    state: row.state,
    recordedAt: row.recorded_at,
    deduped,
    providerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    appointmentWrite: false,
    authorityPromoted: false,
  });
}

function mapStorageError(error) {
  const message = String(error?.message || error || "");
  const mappings = [
    [/owned note contact unavailable/i, "contact_unavailable", 409],
    [/owned note appointment mismatch/i, "appointment_contact_mismatch", 409],
    [/owned note identity already exists/i, "note_identity_conflict", 409],
    [/owned note revision conflict/i, "note_revision_conflict", 409],
    [/owned note is not active/i, "note_not_active", 409],
    [/owned note archive conflict/i, "note_archive_conflict", 409],
    [/owned note restore conflict/i, "note_restore_conflict", 409],
  ];
  const mapped = mappings.find(([pattern]) => pattern.test(message));
  return mapped ? new OwnedNoteError(message, mapped[1], mapped[2]) : error;
}

export function ownedNoteReleaseReadiness(mode = OWNED_NOTE_SOURCE_MODE) {
  const sourceMode = mode === "active" ? "active" : "shadow";
  return Object.freeze({
    version: OWNED_NOTE_CONTRACT_VERSION,
    sourceMode,
    enabled: sourceMode === "active",
    providerFallback: null,
    providerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    appointmentWrite: false,
    destructiveDeleteExposed: false,
    authorityPromotion: false,
  });
}

export async function captureOwnedNoteVersion(db, input, now = new Date().toISOString(), options = {}) {
  const readiness = ownedNoteReleaseReadiness(options.sourceMode ?? OWNED_NOTE_SOURCE_MODE);
  if (!readiness.enabled) fail("owned note commands remain source-level shadow", "owned_note_shadow_only", 503);
  if (!db?.prepare) fail("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const recordedMs = Date.parse(now);
  if (!Number.isFinite(recordedMs)) fail("valid command time required", "invalid_command_time", 400);
  const recordedAt = new Date(recordedMs).toISOString();
  const command = normalize(input);
  const digest = await commandDigest(command);
  const keyDigest = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const versionId = `onv_${keyDigest.slice(0, 32)}`;

  const replay = await versionByKey(db, command.actor, command.idempotencyKey);
  if (replay) {
    if (replay.command_sha256 !== digest) fail("idempotency key was already used for another note command", "idempotency_conflict");
    return publicVersion(replay, true);
  }

  const contact = await db.prepare("SELECT id, archived_at FROM contacts WHERE id = ?")
    .bind(command.contactId).first();
  if (!contact) fail("contact not found", "contact_not_found", 404);
  if (contact.archived_at) fail("contact is archived", "contact_unavailable");
  if (command.appointmentId) {
    const appointment = await db.prepare("SELECT contact_id FROM appointments WHERE id = ?")
      .bind(command.appointmentId).first();
    if (!appointment || appointment.contact_id !== command.contactId) {
      fail("appointment does not belong to contact", "appointment_contact_mismatch");
    }
  }

  let prior = null;
  let noteId = command.noteId;
  let revision = 1;
  let priorRevision = 0;
  let body = command.body;
  let state = "active";
  if (command.action === "create") {
    noteId = `onote_${keyDigest.slice(0, 32)}`;
  } else {
    prior = await latestVersion(db, command.noteId);
    if (!prior) fail("owned note not found", "note_not_found", 404);
    if (prior.contact_id !== command.contactId || (prior.appointment_id || null) !== command.appointmentId) {
      fail("owned note identity changed", "note_identity_conflict");
    }
    if (Number(prior.revision) !== command.expectedRevision) fail("owned note revision changed", "note_revision_conflict");
    revision = command.expectedRevision + 1;
    priorRevision = command.expectedRevision;
    if (command.action === "revise") {
      if (prior.state !== "active") fail("archived note cannot be revised", "note_not_active");
    } else {
      body = prior.body_clean;
      if (command.action === "archive") {
        if (prior.state !== "active") fail("note is already archived", "note_not_active");
        state = "archived";
      } else {
        if (prior.state !== "archived") fail("note is already active", "note_not_archived");
        state = "active";
      }
    }
  }
  const bodySha256 = await sha256(body);

  let inserted;
  try {
    inserted = await db.prepare(
      `INSERT OR IGNORE INTO owned_note_versions (
         id, note_id, contact_id, appointment_id, actor, idempotency_key, action,
         revision, prior_revision, body_clean, body_sha256, command_sha256, state, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, noteId, command.contactId, command.appointmentId, command.actor,
      command.idempotencyKey, command.action, revision, priorRevision, body,
      bodySha256, digest, state, recordedAt,
    ).run();
  } catch (error) {
    throw mapStorageError(error);
  }

  const captured = await versionByKey(db, command.actor, command.idempotencyKey);
  if (!captured) fail("owned note command was not recorded", "note_storage_conflict", 500);
  if (captured.command_sha256 !== digest) fail("idempotency key was already used for another note command", "idempotency_conflict");
  return publicVersion(captured, changes(inserted) === 0);
}

export async function readOwnedNotes(db, { contactId, limit = 50 } = {}) {
  const id = clean(contactId);
  if (!REFERENCE.test(id)) fail("exact contact id required", "invalid_contact_id", 400);
  const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 50;
  try {
    const result = await db.prepare(
      `WITH ranked AS (
         SELECT version.*,
                ROW_NUMBER() OVER (PARTITION BY note_id ORDER BY revision DESC) AS recency_rank,
                MIN(recorded_at) OVER (PARTITION BY note_id) AS created_at
           FROM owned_note_versions version
          WHERE contact_id = ?
       )
       SELECT note_id, contact_id, appointment_id,
              (
                SELECT content.actor
                  FROM owned_note_versions content
                 WHERE content.note_id = ranked.note_id
                   AND content.revision <= ranked.revision
                   AND content.action IN ('create', 'revise')
                 ORDER BY content.revision DESC
                 LIMIT 1
              ) AS authored_by,
              actor AS recorded_by, revision, body_clean AS body, state, created_at,
              recorded_at AS updated_at, 'owned' AS authority
         FROM ranked
        WHERE recency_rank = 1 AND state = 'active'
        ORDER BY datetime(updated_at) DESC, note_id
        LIMIT ?`,
    ).bind(id, bounded).all();
    return Object.freeze({
      version: OWNED_NOTE_CONTRACT_VERSION,
      state: "ready",
      readOnly: true,
      notes: (result?.results || []).map((row) => Object.freeze({ ...row, revision: Number(row.revision) })),
    });
  } catch (error) {
    if (/no such table: owned_note_versions/i.test(String(error?.message || error))) {
      return Object.freeze({
        version: OWNED_NOTE_CONTRACT_VERSION,
        state: "unavailable",
        reason: "schema_unavailable",
        readOnly: true,
        notes: [],
      });
    }
    throw error;
  }
}
