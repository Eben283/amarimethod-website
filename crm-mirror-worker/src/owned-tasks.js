// Provider-neutral revisioned Staff tasks.
//
// The production command route is pinned to source-level shadow. Tests may exercise the
// separately reviewable active store, which writes only immutable D1 task versions. It has no
// GHL/provider adapter, customer message sender, payment, appointment mutation, or authority
// promotion.

export const OWNED_TASK_SOURCE_MODE = "shadow";
export const OWNED_TASK_CONTRACT_VERSION = "owned-task-authority.v1";

const REFERENCE = /^[A-Za-z0-9_-]{1,160}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const EXPLICIT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i;
const ACTIONS = new Set(["create", "revise", "complete", "reopen", "archive", "restore"]);
const ACTORS = new Set(["Eben", "Garrett"]);
const MAX_TITLE_LENGTH = 300;

export class OwnedTaskError extends Error {
  constructor(message, code = "owned_task_invalid", status = 409) {
    super(message);
    this.name = "OwnedTaskError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code, status = 409) {
  throw new OwnedTaskError(message, code, status);
}

function clean(value) {
  return String(value || "").trim();
}

function normalizedTitle(value) {
  const title = typeof value === "string" ? value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim() : "";
  if (!title) fail("task title required", "invalid_task_title", 400);
  if (title.length > MAX_TITLE_LENGTH) fail(`task title must be ${MAX_TITLE_LENGTH} characters or fewer`, "invalid_task_title", 400);
  return title;
}

function normalizedDueAt(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !EXPLICIT_TIMESTAMP.test(value)) {
    fail("task due time must include an explicit timezone", "invalid_task_due_at", 400);
  }
  const dueMs = Date.parse(value);
  if (!Number.isFinite(dueMs)) fail("valid task due time required", "invalid_task_due_at", 400);
  return new Date(dueMs).toISOString();
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
  const taskId = clean(input?.taskId) || null;
  const expectedRevision = input?.expectedRevision == null ? 0 : Number(input.expectedRevision);
  if (!ACTIONS.has(action)) fail("recognized task action required", "invalid_task_action", 400);
  if (!REFERENCE.test(contactId)) fail("exact contact id required", "invalid_contact_id", 400);
  if (appointmentId && !REFERENCE.test(appointmentId)) fail("valid appointment id required", "invalid_appointment_id", 400);
  if (!ACTORS.has(actor)) fail("recognized Staff actor required", "invalid_actor", 400);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) fail("valid idempotency key required", "invalid_idempotency_key", 400);
  if (action === "create") {
    if (taskId || expectedRevision !== 0) fail("create cannot supply task identity or revision", "invalid_task_create", 400);
  } else if (!taskId || !REFERENCE.test(taskId) || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    fail("exact task identity and revision required", "invalid_task_identity", 400);
  }
  const definesContent = action === "create" || action === "revise";
  if (definesContent && !Object.hasOwn(input || {}, "dueAt")) {
    fail("task due time must be explicitly supplied or null", "invalid_task_due_at", 400);
  }
  const title = definesContent ? normalizedTitle(input?.title) : null;
  const dueAt = definesContent ? normalizedDueAt(input?.dueAt) : null;
  return { action, contactId, appointmentId, actor, idempotencyKey, taskId, expectedRevision, title, dueAt };
}

async function commandDigest(command) {
  return sha256([
    OWNED_TASK_CONTRACT_VERSION,
    command.actor,
    command.idempotencyKey,
    command.action,
    command.contactId,
    command.appointmentId || "",
    command.taskId || "",
    String(command.expectedRevision),
    command.title || "",
    command.dueAt || "",
  ].join("\n"));
}

async function versionByKey(db, actor, idempotencyKey) {
  return db.prepare(
    `SELECT * FROM owned_task_versions
      WHERE actor = ? AND idempotency_key = ?`,
  ).bind(actor, idempotencyKey).first();
}

async function latestVersion(db, taskId) {
  return db.prepare(
    `SELECT * FROM owned_task_versions
      WHERE task_id = ? ORDER BY revision DESC LIMIT 1`,
  ).bind(taskId).first();
}

function publicVersion(row, deduped) {
  return Object.freeze({
    versionId: row.id,
    taskId: row.task_id,
    contactId: row.contact_id,
    appointmentId: row.appointment_id || null,
    actor: row.actor,
    action: row.action,
    revision: Number(row.revision),
    priorRevision: Number(row.prior_revision),
    title: row.title_clean,
    dueAt: row.due_at || null,
    state: row.state,
    archivedFromState: row.archived_from_state || null,
    completedAt: row.completed_at || null,
    recordedAt: row.recorded_at,
    deduped,
    providerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    appointmentWrite: false,
    destructiveDeleteExposed: false,
    authorityPromoted: false,
  });
}

function mapStorageError(error) {
  const message = String(error?.message || error || "");
  const mappings = [
    [/owned task contact unavailable/i, "contact_unavailable", 409],
    [/owned task appointment mismatch/i, "appointment_contact_mismatch", 409],
    [/owned task identity already exists/i, "task_identity_conflict", 409],
    [/owned task revision conflict/i, "task_revision_conflict", 409],
    [/owned task is not open/i, "task_not_open", 409],
    [/owned task completion conflict/i, "task_completion_conflict", 409],
    [/owned task reopen conflict/i, "task_reopen_conflict", 409],
    [/owned task archive conflict/i, "task_archive_conflict", 409],
    [/owned task restore conflict/i, "task_restore_conflict", 409],
  ];
  const mapped = mappings.find(([pattern]) => pattern.test(message));
  return mapped ? new OwnedTaskError(message, mapped[1], mapped[2]) : error;
}

export function ownedTaskReleaseReadiness(mode = OWNED_TASK_SOURCE_MODE) {
  const sourceMode = mode === "active" ? "active" : "shadow";
  return Object.freeze({
    version: OWNED_TASK_CONTRACT_VERSION,
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

export async function captureOwnedTaskVersion(db, input, now = new Date().toISOString(), options = {}) {
  const readiness = ownedTaskReleaseReadiness(options.sourceMode ?? OWNED_TASK_SOURCE_MODE);
  if (!readiness.enabled) fail("owned task commands remain source-level shadow", "owned_task_shadow_only", 503);
  if (!db?.prepare) fail("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const recordedMs = Date.parse(now);
  if (!Number.isFinite(recordedMs)) fail("valid command time required", "invalid_command_time", 400);
  const recordedAt = new Date(recordedMs).toISOString();
  const command = normalize(input);
  const digest = await commandDigest(command);
  const keyDigest = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const versionId = `otv_${keyDigest.slice(0, 32)}`;

  const replay = await versionByKey(db, command.actor, command.idempotencyKey);
  if (replay) {
    if (replay.command_sha256 !== digest) fail("idempotency key was already used for another task command", "idempotency_conflict");
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
  let taskId = command.taskId;
  let revision = 1;
  let priorRevision = 0;
  let title = command.title;
  let dueAt = command.dueAt;
  let state = "open";
  let archivedFromState = null;
  let completedAt = null;
  if (command.action === "create") {
    taskId = `otask_${keyDigest.slice(0, 32)}`;
  } else {
    prior = await latestVersion(db, command.taskId);
    if (!prior) fail("owned task not found", "task_not_found", 404);
    if (prior.contact_id !== command.contactId || (prior.appointment_id || null) !== command.appointmentId) {
      fail("owned task identity changed", "task_identity_conflict");
    }
    if (Number(prior.revision) !== command.expectedRevision) fail("owned task revision changed", "task_revision_conflict");
    revision = command.expectedRevision + 1;
    priorRevision = command.expectedRevision;
    if (command.action === "revise") {
      if (prior.state !== "open") fail("only an open task can be revised", "task_not_open");
    } else {
      title = prior.title_clean;
      dueAt = prior.due_at || null;
      if (command.action === "complete") {
        if (prior.state !== "open") fail("only an open task can be completed", "task_not_open");
        state = "completed";
        completedAt = recordedAt;
      } else if (command.action === "reopen") {
        if (prior.state !== "completed") fail("only a completed task can be reopened", "task_not_completed");
      } else if (command.action === "archive") {
        if (prior.state === "archived") fail("task is already archived", "task_already_archived");
        state = "archived";
        archivedFromState = prior.state;
        completedAt = prior.completed_at || null;
      } else {
        if (prior.state !== "archived") fail("task is already active", "task_not_archived");
        state = prior.archived_from_state;
        completedAt = prior.completed_at || null;
      }
    }
  }
  const titleSha256 = await sha256(title);

  let inserted;
  try {
    inserted = await db.prepare(
      `INSERT OR IGNORE INTO owned_task_versions (
         id, task_id, contact_id, appointment_id, actor, idempotency_key, action,
         revision, prior_revision, title_clean, title_sha256, due_at, state,
         archived_from_state, completed_at, command_sha256, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, taskId, command.contactId, command.appointmentId, command.actor,
      command.idempotencyKey, command.action, revision, priorRevision, title,
      titleSha256, dueAt, state, archivedFromState, completedAt, digest, recordedAt,
    ).run();
  } catch (error) {
    throw mapStorageError(error);
  }

  const captured = await versionByKey(db, command.actor, command.idempotencyKey);
  if (!captured) fail("owned task command was not recorded", "task_storage_conflict", 500);
  if (captured.command_sha256 !== digest) fail("idempotency key was already used for another task command", "idempotency_conflict");
  return publicVersion(captured, changes(inserted) === 0);
}

export async function readOwnedTasks(db, { contactId, limit = 50 } = {}) {
  const id = clean(contactId);
  if (!REFERENCE.test(id)) fail("exact contact id required", "invalid_contact_id", 400);
  const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 50;
  try {
    const result = await db.prepare(
      `WITH ranked AS (
         SELECT version.*,
                ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY revision DESC) AS recency_rank,
                MIN(recorded_at) OVER (PARTITION BY task_id) AS created_at
           FROM owned_task_versions version
          WHERE contact_id = ?
       )
       SELECT task_id, contact_id, appointment_id,
              (
                SELECT content.actor
                  FROM owned_task_versions content
                 WHERE content.task_id = ranked.task_id
                   AND content.revision <= ranked.revision
                   AND content.action IN ('create', 'revise')
                 ORDER BY content.revision DESC
                 LIMIT 1
              ) AS defined_by,
              actor AS recorded_by, revision, title_clean AS title, due_at,
              completed_at, state AS status, state, created_at,
              recorded_at AS updated_at, 'owned' AS authority
         FROM ranked
        WHERE recency_rank = 1 AND state <> 'archived'
        ORDER BY CASE state WHEN 'open' THEN 0 ELSE 1 END,
                 CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
                 datetime(due_at), datetime(updated_at) DESC, task_id
        LIMIT ?`,
    ).bind(id, bounded).all();
    return Object.freeze({
      version: OWNED_TASK_CONTRACT_VERSION,
      state: "ready",
      readOnly: true,
      tasks: (result?.results || []).map((row) => Object.freeze({ ...row, revision: Number(row.revision) })),
    });
  } catch (error) {
    if (/no such table: owned_task_versions/i.test(String(error?.message || error))) {
      return Object.freeze({
        version: OWNED_TASK_CONTRACT_VERSION,
        state: "unavailable",
        reason: "schema_unavailable",
        readOnly: true,
        tasks: [],
      });
    }
    throw error;
  }
}
