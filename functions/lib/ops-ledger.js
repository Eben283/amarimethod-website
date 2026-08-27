// Operations Ledger core. This module is deliberately provider-agnostic: the
// caller supplies a D1-compatible AUTOMATION_DB and a server-resolved
// principal. It never accepts a user-supplied actor string or stores payloads.

export const ACTOR_KINDS = Object.freeze(["human", "codex", "worker", "github", "cloudflare"]);
export const TASK_STATUSES = Object.freeze(["todo", "open", "in_progress", "blocked", "done", "completed", "cancelled"]);
export const RELEASE_STATUSES = Object.freeze(["planned", "pending", "queued", "building", "active", "succeeded", "failed", "rolled_back", "cancelled"]);

const ACTOR_SET = new Set(ACTOR_KINDS);
const TASK_STATUS_SET = new Set(TASK_STATUSES);
const RELEASE_STATUS_SET = new Set(RELEASE_STATUSES);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SENSITIVE_WORDS = /(?:^|[._\s-])(email|e-mail|phone|mobile|tel|telephone|name|full_name|first_name|last_name|body|message|content|payload|raw|value|values|secret|token|password|passwd|api[_ -]?key|authorization|cookie|jwt|bearer|ssn|social[_ -]?security|dob|birth(?:day|date)?|address|street|medical|diagnosis|patient|client[_ -]?name|note|notes)(?:$|[._\s-])/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?\d[\d .()/-]{7,}\d)/;
const REF = /^[^\s\u0000-\u001f\u007f]{1,200}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const SAFE_FIELD_EXCEPTIONS = new Set(["contact_id", "appointment_id", "order_id", "invoice_id", "provider_id", "record_id", "subject_ref"]);

export class OpsLedgerError extends Error {
  constructor(message, code = "invalid_ledger_input", status = 400) {
    super(message);
    this.name = "OpsLedgerError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code = "invalid_ledger_input", status = 400) {
  throw new OpsLedgerError(message, code, status);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function strictKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label}.${key} is not an allowed field`, "disallowed_field");
  }
}

function text(value, label, max = 200) {
  if (typeof value !== "string") fail(`${label} must be a string`);
  const result = value.trim().replace(/[\t\r\n ]+/g, " ");
  if (!result || result.length > max) fail(`${label} must be between 1 and ${max} characters`);
  return result;
}

function opaqueRef(value, label, max = 200) {
  const result = text(value, label, max);
  if (!REF.test(result)) fail(`${label} must be an opaque, single-line reference`);
  return result;
}

/**
 * Summaries are intentionally not a general text sink. The ledger is an
 * operational index, not a place to copy CRM records or message content.
 */
export function sanitizeSummary(value, label = "summary") {
  const result = text(value, label, 280);
  if (EMAIL.test(result) || PHONE.test(result) || SENSITIVE_WORDS.test(result)) {
    fail(`${label} appears to contain personal data, a secret, or a raw record field`, "unsafe_summary");
  }
  return result;
}

export function sanitizeText(value, label = "text", max = 200) {
  return text(value, label, max);
}

function actorKind(principal) {
  return principal.kind || principal.type || principal.actorKind;
}

/** A principal must be resolved by the server before reaching this module. */
export function validatePrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    fail("principal must be a server-resolved object", "invalid_principal");
  }
  if (Object.prototype.hasOwnProperty.call(principal, "actor")) {
    fail("raw actor strings are not accepted; provide a resolved principal", "raw_actor_rejected");
  }
  strictKeys(principal, new Set(["kind", "type", "actorKind", "id", "ref", "actorId"]), "principal");
  const kind = actorKind(principal);
  if (!ACTOR_SET.has(kind)) fail("principal kind is unsupported", "invalid_principal");
  const ref = principal.id ?? principal.ref ?? principal.actorId;
  return { kind, ref: opaqueRef(ref, "principal.id") };
}

function fieldNames(value, label = "fieldNames") {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) fail(`${label} must be an array of at most 50 names`);
  const output = [];
  for (const item of value) {
    const name = text(item, `${label}[]`, 80).toLowerCase();
    if (!FIELD.test(name)) fail(`${label} contains an invalid field name`);
    if (SENSITIVE_WORDS.test(`.${name}.`) && !SAFE_FIELD_EXCEPTIONS.has(name)) {
      fail(`${label} contains a sensitive field name`, "sensitive_field_name");
    }
    if (!output.includes(name)) output.push(name);
  }
  return output;
}

function counts(value, label = "counts") {
  if (value == null) return {};
  plainObject(value, label);
  const keys = Object.keys(value);
  if (keys.length > 50) fail(`${label} has too many keys`);
  const output = {};
  for (const key of keys) {
    const names = fieldNames([key], `${label} key`);
    const name = names[0];
    const count = value[key];
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) {
      fail(`${label}.${name} must be a non-negative integer`);
    }
    output[name] = count;
  }
  return output;
}

function eventType(value) {
  const type = text(value, "eventType", 100).toLowerCase();
  if (!/^[a-z][a-z0-9_.:-]{1,99}$/.test(type)) fail("eventType has an invalid format");
  return type;
}

function subject(value, index) {
  plainObject(value, `subjects[${index}]`);
  strictKeys(value, new Set(["type", "subjectType", "ref", "subjectRef", "fieldNames", "counts"]), `subjects[${index}]`);
  const type = text(value.type ?? value.subjectType, `subjects[${index}].type`, 80).toLowerCase();
  if (!/^[a-z][a-z0-9_.:-]{0,79}$/.test(type)) fail(`subjects[${index}].type has an invalid format`);
  return {
    type,
    ref: opaqueRef(value.ref ?? value.subjectRef, `subjects[${index}].ref`),
    fieldNames: fieldNames(value.fieldNames, `subjects[${index}].fieldNames`),
    counts: counts(value.counts, `subjects[${index}].counts`),
  };
}

export function validateAuditEvent(input) {
  plainObject(input, "event");
  strictKeys(input, new Set([
    "eventId", "id", "eventType", "type", "summary", "occurredAt", "idempotencyKey",
    "principal", "correlationRef", "correlationId", "taskId", "releaseId", "fieldNames", "counts", "subjects",
  ]), "event");
  const principal = validatePrincipal(input.principal);
  const key = opaqueRef(input.idempotencyKey, "idempotencyKey");
  const occurredAt = input.occurredAt == null ? null : Number(input.occurredAt);
  if (occurredAt != null && (!Number.isSafeInteger(occurredAt) || occurredAt < 0)) fail("occurredAt must be a timestamp in milliseconds");
  const subjects = input.subjects == null ? [] : input.subjects;
  if (!Array.isArray(subjects) || subjects.length > 20) fail("subjects must contain at most 20 references");
  return {
    id: input.eventId || input.id || null,
    idempotencyKey: key,
    eventType: eventType(input.eventType ?? input.type),
    summary: sanitizeSummary(input.summary),
    occurredAt,
    principal,
    correlationRef: input.correlationRef == null ? (input.correlationId == null ? null : opaqueRef(input.correlationId, "correlationId")) : opaqueRef(input.correlationRef, "correlationRef"),
    taskId: input.taskId == null ? null : opaqueRef(input.taskId, "taskId"),
    releaseId: input.releaseId == null ? null : opaqueRef(input.releaseId, "releaseId"),
    fieldNames: fieldNames(input.fieldNames),
    counts: counts(input.counts),
    subjects: subjects.map(subject),
  };
}

export function validateAuditSubject(input) {
  return subject(input, 0);
}

function id(prefix) {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uuid}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function digest(value) {
  const bytes = new TextEncoder().encode(stable(value));
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  // Cloudflare and supported Node runtimes both expose Web Crypto. This is a
  // defensive fallback for tiny test doubles, not a security primitive.
  let h = 2166136261;
  for (const byte of bytes) h = Math.imul(h ^ byte, 16777619);
  return `${(h >>> 0).toString(16).padStart(8, "0")}${"0".repeat(56)}`;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

// D1 statements expose bind(). DatabaseSync is useful for local tests and
// exposes run/get/all directly. Keeping this adapter here makes the core use
// the same call shape in both environments.
function prepare(db, sql) {
  const raw = db.prepare(sql);
  if (typeof raw.bind === "function") return raw;
  return {
    bind(...args) {
      return {
        run: () => raw.run(...args),
        first: () => raw.get(...args),
        all: () => ({ results: raw.all(...args) }),
      };
    },
  };
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function runBatch(db, statements) {
  if (typeof db.batch === "function") return db.batch(statements);
  const output = [];
  for (const statement of statements) output.push(await statement.run());
  return output;
}

function shapeSubject(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    type: row.subject_type,
    ref: row.subject_ref,
    fieldNames: parseJson(row.field_names_json, []),
    counts: parseJson(row.counts_json, {}),
    createdAt: Number(row.created_at),
  };
}

async function subjectsFor(db, eventId) {
  const result = await prepare(db,
    "SELECT * FROM ops_audit_subjects WHERE event_id = ? ORDER BY id",
  ).bind(eventId).all();
  return (result?.results || []).map(shapeSubject);
}

async function shapeEvent(db, row, includeSubjects = true) {
  if (!row) return null;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    summary: row.summary,
    fieldNames: parseJson(row.field_names_json, []),
    counts: parseJson(row.counts_json, {}),
    correlationRef: row.correlation_ref || null,
    taskId: row.task_id || null,
    releaseId: row.release_id || null,
    actor: { kind: row.actor_kind, ref: row.actor_ref },
    occurredAt: Number(row.occurred_at),
    recordedAt: Number(row.recorded_at),
    subjects: includeSubjects ? await subjectsFor(db, row.id) : [],
  };
}

function eventHashInput(event) {
  return {
    eventType: event.eventType,
    summary: event.summary,
    // A caller that omits occurredAt is saying "record when accepted";
    // retries must not conflict merely because they arrived milliseconds
    // apart. Explicit timestamps remain part of the idempotent payload.
    occurredAt: event.occurredAtProvided ? event.occurredAt : null,
    principal: event.principal,
    correlationRef: event.correlationRef,
    taskId: event.taskId,
    releaseId: event.releaseId,
    fieldNames: event.fieldNames,
    counts: event.counts,
    subjects: event.subjects,
  };
}

/** Append one immutable event; retries with the same key return the original. */
export async function appendAuditEvent(db, input, options = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 0) fail("now must be a timestamp in milliseconds");
  const event = {
    ...validateAuditEvent(input),
    occurredAtProvided: input.occurredAt != null,
    occurredAt: input.occurredAt == null ? now : Number(input.occurredAt),
  };
  const requestHash = await digest(eventHashInput(event));
  const eventId = event.id ? opaqueRef(event.id, "eventId") : id("ops-event");
  const insert = prepare(db,
    `INSERT INTO ops_audit_events
      (id, idempotency_key, event_type, summary, field_names_json, counts_json,
       correlation_ref, task_id, release_id, actor_kind, actor_ref, occurred_at,
       recorded_at, request_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
  ).bind(
    eventId, event.idempotencyKey, event.eventType, event.summary,
    JSON.stringify(event.fieldNames), JSON.stringify(event.counts), event.correlationRef,
    event.taskId, event.releaseId, event.principal.kind, event.principal.ref,
    event.occurredAt, now, requestHash,
  );
  const result = await insert.run();
  if (changes(result) === 0) {
    const existing = await prepare(db, "SELECT * FROM ops_audit_events WHERE idempotency_key = ?")
      .bind(event.idempotencyKey).first();
    if (!existing) fail("idempotency claim could not be read", "idempotency_read_failed", 500);
    if (existing.request_hash !== requestHash) fail("idempotency key was used for different event data", "idempotency_conflict", 409);
    return { state: "existing", event: await shapeEvent(db, existing) };
  }
  const subjectStatements = event.subjects.map((item, index) => prepare(db,
    `INSERT INTO ops_audit_subjects
      (id, event_id, subject_type, subject_ref, field_names_json, counts_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, subject_type, subject_ref) DO NOTHING`,
  ).bind(
    `${eventId}:subject:${index}`, eventId, item.type, item.ref,
    JSON.stringify(item.fieldNames), JSON.stringify(item.counts), now,
  ));
  if (subjectStatements.length) await runBatch(db, subjectStatements);
  const saved = await prepare(db, "SELECT * FROM ops_audit_events WHERE id = ?").bind(eventId).first();
  return { state: "created", event: await shapeEvent(db, saved) };
}

export const appendAudit = appendAuditEvent;
export const appendOpsAuditEvent = appendAuditEvent;

export async function listAuditEvents(db, filters = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  plainObject(filters, "filters");
  strictKeys(filters, new Set(["eventType", "taskId", "releaseId", "correlationRef", "limit", "before"]), "filters");
  const where = [];
  const args = [];
  if (filters.eventType != null) { where.push("event_type = ?"); args.push(eventType(filters.eventType)); }
  if (filters.taskId != null) { where.push("task_id = ?"); args.push(opaqueRef(filters.taskId, "taskId")); }
  if (filters.releaseId != null) { where.push("release_id = ?"); args.push(opaqueRef(filters.releaseId, "releaseId")); }
  if (filters.correlationRef != null) { where.push("correlation_ref = ?"); args.push(opaqueRef(filters.correlationRef, "correlationRef")); }
  if (filters.before != null) { where.push("occurred_at < ?"); args.push(Number(filters.before)); }
  const limit = filters.limit == null ? 50 : Number(filters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail("limit must be between 1 and 200");
  args.push(limit);
  const query = `SELECT * FROM ops_audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY occurred_at DESC, id DESC LIMIT ?`;
  const result = await prepare(db, query).bind(...args).all();
  return Promise.all((result?.results || []).map((row) => shapeEvent(db, row)));
}

export const listOpsAuditEvents = listAuditEvents;

function taskInput(input) {
  plainObject(input, "task");
  strictKeys(input, new Set(["id", "taskId", "idempotencyKey", "title", "status", "priority", "ownerKind", "ownerRef", "sourceRef", "dueAt", "principal"]), "task");
  const principal = validatePrincipal(input.principal);
  const status = input.status == null ? "open" : text(input.status, "status", 30).toLowerCase();
  if (!TASK_STATUS_SET.has(status)) fail("task status is unsupported");
  const priority = input.priority == null ? "normal" : text(input.priority, "priority", 20).toLowerCase();
  if (!PRIORITIES.has(priority)) fail("task priority is unsupported");
  const dueAt = input.dueAt == null ? null : Number(input.dueAt);
  if (dueAt != null && (!Number.isSafeInteger(dueAt) || dueAt < 0)) fail("dueAt must be a timestamp in milliseconds");
  return {
    id: input.id || input.taskId || null,
    idempotencyKey: opaqueRef(input.idempotencyKey, "idempotencyKey"),
    title: sanitizeSummary(input.title, "title"), status, priority,
    ownerKind: input.ownerKind == null ? null : text(input.ownerKind, "ownerKind", 40).toLowerCase(),
    ownerRef: input.ownerRef == null ? null : opaqueRef(input.ownerRef, "ownerRef"),
    sourceRef: input.sourceRef == null ? null : opaqueRef(input.sourceRef, "sourceRef"),
    dueAt, principal,
  };
}

function shapeTask(row) {
  if (!row) return null;
  return {
    id: row.id, idempotencyKey: row.idempotency_key, title: row.title, status: row.status,
    priority: row.priority, owner: row.owner_ref ? { kind: row.owner_kind, ref: row.owner_ref } : null,
    sourceRef: row.source_ref || null, dueAt: row.due_at == null ? null : Number(row.due_at),
    createdBy: { kind: row.created_by_kind, ref: row.created_by_ref },
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

export async function createTask(db, input, options = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  const task = taskInput(input);
  const now = Number(options.now ?? Date.now());
  const requestHash = await digest({ ...task, principal: task.principal });
  const taskId = task.id ? opaqueRef(task.id, "taskId") : id("ops-task");
  const result = await prepare(db,
    `INSERT INTO ops_tasks
      (id, idempotency_key, title, status, priority, owner_kind, owner_ref, source_ref,
       due_at, request_hash, created_by_kind, created_by_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
  ).bind(taskId, task.idempotencyKey, task.title, task.status, task.priority, task.ownerKind,
    task.ownerRef, task.sourceRef, task.dueAt, requestHash, task.principal.kind, task.principal.ref, now, now).run();
  const row = await prepare(db, "SELECT * FROM ops_tasks WHERE idempotency_key = ?").bind(task.idempotencyKey).first();
  if (!row) fail("task could not be read after insert", "task_read_failed", 500);
  if (changes(result) === 0 && row.request_hash !== requestHash) fail("idempotency key was used for different task data", "idempotency_conflict", 409);
  if (changes(result) === 1) {
    await appendAuditEvent(db, {
      eventType: "task.created", summary: "Task created", idempotencyKey: `task-created:${task.idempotencyKey}`,
      principal: input.principal, taskId: row.id, fieldNames: ["status", "priority"],
      subjects: [{ type: "task", ref: row.id, fieldNames: ["status", "priority"] }],
    }, { now });
  }
  return { state: changes(result) === 1 ? "created" : "existing", task: shapeTask(row) };
}

export const createOpsTask = createTask;

export async function getTask(db, taskId) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  const row = await prepare(db, "SELECT * FROM ops_tasks WHERE id = ?").bind(opaqueRef(taskId, "taskId")).first();
  return shapeTask(row);
}

export const getOpsTask = getTask;

export async function listTasks(db, filters = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  plainObject(filters, "filters");
  strictKeys(filters, new Set(["status", "ownerKind", "ownerRef", "limit"]), "filters");
  const where = []; const args = [];
  if (filters.status != null) { const status = text(filters.status, "status", 30).toLowerCase(); if (!TASK_STATUS_SET.has(status)) fail("task status is unsupported"); where.push("status = ?"); args.push(status); }
  if (filters.ownerKind != null) { where.push("owner_kind = ?"); args.push(text(filters.ownerKind, "ownerKind", 40).toLowerCase()); }
  if (filters.ownerRef != null) { where.push("owner_ref = ?"); args.push(opaqueRef(filters.ownerRef, "ownerRef")); }
  const limit = filters.limit == null ? 50 : Number(filters.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail("limit must be between 1 and 200"); args.push(limit);
  const result = await prepare(db, `SELECT * FROM ops_tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(...args).all();
  return (result?.results || []).map(shapeTask);
}

export const listOpsTasks = listTasks;

export async function updateTask(db, taskIdOrInput, patchOrOptions, maybeOptions = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  const taskId = typeof taskIdOrInput === "object" ? taskIdOrInput.taskId : taskIdOrInput;
  const patch = typeof taskIdOrInput === "object" ? (taskIdOrInput.patch || {}) : (patchOrOptions || {});
  const options = typeof taskIdOrInput === "object" ? taskIdOrInput : maybeOptions;
  const principal = validatePrincipal(options.principal);
  const idValue = opaqueRef(taskId, "taskId");
  plainObject(patch, "patch"); strictKeys(patch, new Set(["title", "status", "priority", "ownerKind", "ownerRef", "sourceRef", "dueAt"]), "patch");
  const before = await prepare(db, "SELECT * FROM ops_tasks WHERE id = ?").bind(idValue).first();
  if (!before) fail("task not found", "task_not_found", 404);
  const fields = []; const values = []; const changed = [];
  for (const key of Object.keys(patch)) {
    let value = patch[key];
    if (key === "title") value = sanitizeSummary(value, "title");
    if (key === "status") { value = text(value, "status", 30).toLowerCase(); if (!TASK_STATUS_SET.has(value)) fail("task status is unsupported"); }
    if (key === "priority") { value = text(value, "priority", 20).toLowerCase(); if (!PRIORITIES.has(value)) fail("task priority is unsupported"); }
    if (["ownerRef", "sourceRef"].includes(key)) value = value == null ? null : opaqueRef(value, key);
    if (key === "ownerKind") value = value == null ? null : text(value, key, 40).toLowerCase();
    if (key === "dueAt") { value = value == null ? null : Number(value); if (value != null && (!Number.isSafeInteger(value) || value < 0)) fail("dueAt must be a timestamp in milliseconds"); }
    const column = { title: "title", status: "status", priority: "priority", ownerKind: "owner_kind", ownerRef: "owner_ref", sourceRef: "source_ref", dueAt: "due_at" }[key];
    const old = before[column] == null ? null : before[column];
    if (old !== value) { fields.push(`${column} = ?`); values.push(value); changed.push(key); }
  }
  if (!changed.length) return { state: "unchanged", task: shapeTask(before) };
  const now = Number(options.now ?? Date.now()); values.push(now, idValue);
  await prepare(db, `UPDATE ops_tasks SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).bind(...values).run();
  const row = await prepare(db, "SELECT * FROM ops_tasks WHERE id = ?").bind(idValue).first();
  const key = opaqueRef(options.idempotencyKey, "idempotencyKey");
  await appendAuditEvent(db, { eventType: changed.includes("status") ? "task.status_changed" : "task.updated", summary: "Task updated", idempotencyKey: `task-update:${key}`, principal, taskId: idValue, fieldNames: changed, subjects: [{ type: "task", ref: idValue, fieldNames: changed }] }, { now });
  return { state: "updated", task: shapeTask(row) };
}

export const updateOpsTask = updateTask;

function releaseInput(input) {
  plainObject(input, "release");
  strictKeys(input, new Set(["id", "releaseId", "idempotencyKey", "releaseRef", "serviceRef", "environment", "versionRef", "status", "summary", "sourceRef", "principal"]), "release");
  const principal = validatePrincipal(input.principal);
  const status = input.status == null ? "planned" : text(input.status, "status", 30).toLowerCase(); if (!RELEASE_STATUS_SET.has(status)) fail("release status is unsupported");
  return {
    id: input.id || input.releaseId || null, idempotencyKey: opaqueRef(input.idempotencyKey, "idempotencyKey"),
    releaseRef: opaqueRef(input.releaseRef, "releaseRef"), serviceRef: opaqueRef(input.serviceRef, "serviceRef", 120),
    environment: opaqueRef(input.environment, "environment", 80), versionRef: opaqueRef(input.versionRef, "versionRef"),
    status, summary: sanitizeSummary(input.summary, "summary"), sourceRef: input.sourceRef == null ? null : opaqueRef(input.sourceRef, "sourceRef"), principal,
  };
}

function shapeRelease(row) {
  if (!row) return null;
  return { id: row.id, idempotencyKey: row.idempotency_key, releaseRef: row.release_ref, serviceRef: row.service_ref, environment: row.environment, versionRef: row.version_ref, status: row.status, summary: row.summary, sourceRef: row.source_ref || null, createdBy: { kind: row.created_by_kind, ref: row.created_by_ref }, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

export async function createRelease(db, input, options = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  const release = releaseInput(input); const now = Number(options.now ?? Date.now()); const requestHash = await digest(release); const releaseId = release.id ? opaqueRef(release.id, "releaseId") : id("ops-release");
  const result = await prepare(db, `INSERT INTO ops_releases
    (id, idempotency_key, release_ref, service_ref, environment, version_ref, status, summary, source_ref, request_hash, created_by_kind, created_by_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`).bind(releaseId, release.idempotencyKey, release.releaseRef, release.serviceRef, release.environment, release.versionRef, release.status, release.summary, release.sourceRef, requestHash, release.principal.kind, release.principal.ref, now, now).run();
  const row = await prepare(db, "SELECT * FROM ops_releases WHERE idempotency_key = ?").bind(release.idempotencyKey).first(); if (!row) fail("release could not be read after insert", "release_read_failed", 500);
  if (changes(result) === 0 && row.request_hash !== requestHash) fail("idempotency key was used for different release data", "idempotency_conflict", 409);
  if (changes(result) === 1) await appendAuditEvent(db, { eventType: "release.created", summary: "Release created", idempotencyKey: `release-created:${release.idempotencyKey}`, principal: input.principal, releaseId: row.id, fieldNames: ["status", "service_ref", "environment", "version_ref"], subjects: [{ type: "release", ref: row.id, fieldNames: ["status", "service_ref", "environment", "version_ref"] }] }, { now });
  return { state: changes(result) === 1 ? "created" : "existing", release: shapeRelease(row) };
}

export const createOpsRelease = createRelease;

export async function getRelease(db, releaseId) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500);
  const row = await prepare(db, "SELECT * FROM ops_releases WHERE id = ?").bind(opaqueRef(releaseId, "releaseId")).first(); return shapeRelease(row);
}

export const getOpsRelease = getRelease;

export async function listReleases(db, filters = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500); plainObject(filters, "filters"); strictKeys(filters, new Set(["status", "serviceRef", "environment", "limit"]), "filters"); const where = []; const args = [];
  if (filters.status != null) { const value = text(filters.status, "status", 30).toLowerCase(); if (!RELEASE_STATUS_SET.has(value)) fail("release status is unsupported"); where.push("status = ?"); args.push(value); }
  if (filters.serviceRef != null) { where.push("service_ref = ?"); args.push(opaqueRef(filters.serviceRef, "serviceRef", 120)); }
  if (filters.environment != null) { where.push("environment = ?"); args.push(opaqueRef(filters.environment, "environment", 80)); }
  const limit = filters.limit == null ? 50 : Number(filters.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail("limit must be between 1 and 200"); args.push(limit);
  const result = await prepare(db, `SELECT * FROM ops_releases ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(...args).all(); return (result?.results || []).map(shapeRelease);
}

export const listOpsReleases = listReleases;

export async function updateRelease(db, releaseIdOrInput, patchOrOptions, maybeOptions = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500); const releaseId = typeof releaseIdOrInput === "object" ? releaseIdOrInput.releaseId : releaseIdOrInput; const patch = typeof releaseIdOrInput === "object" ? (releaseIdOrInput.patch || {}) : (patchOrOptions || {}); const options = typeof releaseIdOrInput === "object" ? releaseIdOrInput : maybeOptions; const principal = validatePrincipal(options.principal); const idValue = opaqueRef(releaseId, "releaseId"); plainObject(patch, "patch"); strictKeys(patch, new Set(["status", "summary", "sourceRef", "versionRef"]), "patch"); const before = await prepare(db, "SELECT * FROM ops_releases WHERE id = ?").bind(idValue).first(); if (!before) fail("release not found", "release_not_found", 404);
  const fields = []; const values = []; const changed = []; for (const key of Object.keys(patch)) { let value = patch[key]; if (key === "status") { value = text(value, "status", 30).toLowerCase(); if (!RELEASE_STATUS_SET.has(value)) fail("release status is unsupported"); } if (["summary"].includes(key)) value = sanitizeSummary(value, key); if (["sourceRef", "versionRef"].includes(key)) value = value == null ? null : opaqueRef(value, key); const column = { status: "status", summary: "summary", sourceRef: "source_ref", versionRef: "version_ref" }[key]; if ((before[column] == null ? null : before[column]) !== value) { fields.push(`${column} = ?`); values.push(value); changed.push(key); } }
  if (!changed.length) return { state: "unchanged", release: shapeRelease(before) }; const now = Number(options.now ?? Date.now()); values.push(now, idValue); await prepare(db, `UPDATE ops_releases SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).bind(...values).run(); const row = await prepare(db, "SELECT * FROM ops_releases WHERE id = ?").bind(idValue).first(); const key = opaqueRef(options.idempotencyKey, "idempotencyKey"); await appendAuditEvent(db, { eventType: changed.includes("status") ? "release.status_changed" : "release.updated", summary: "Release updated", idempotencyKey: `release-update:${key}`, principal, releaseId: idValue, fieldNames: changed, subjects: [{ type: "release", ref: idValue, fieldNames: changed }] }, { now }); return { state: "updated", release: shapeRelease(row) };
}

export const updateOpsRelease = updateRelease;

export async function linkIncident(db, input, options = {}) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500); plainObject(input, "incident link"); strictKeys(input, new Set(["id", "incidentRef", "linkedType", "linkedRef", "relation", "principal"]), "incident link"); const principal = validatePrincipal(input.principal); const now = Number(options.now ?? Date.now()); const linkId = input.id ? opaqueRef(input.id, "id") : id("ops-link"); const result = await prepare(db, `INSERT INTO ops_incident_links (id, incident_ref, linked_type, linked_ref, relation, created_by_kind, created_by_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(incident_ref, linked_type, linked_ref, relation) DO NOTHING`).bind(linkId, opaqueRef(input.incidentRef, "incidentRef"), text(input.linkedType, "linkedType", 80).toLowerCase(), opaqueRef(input.linkedRef, "linkedRef"), text(input.relation || "related", "relation", 80).toLowerCase(), principal.kind, principal.ref, now).run(); return { state: changes(result) ? "created" : "existing", id: linkId };
}

export const createIncidentLink = linkIncident;
export const linkOpsIncident = linkIncident;

export async function listIncidentLinks(db, incidentRef, limit = 50) {
  if (!db) fail("AUTOMATION_DB is required", "ledger_db_missing", 500); const n = Number(limit); if (!Number.isInteger(n) || n < 1 || n > 200) fail("limit must be between 1 and 200"); const result = await prepare(db, "SELECT * FROM ops_incident_links WHERE incident_ref = ? ORDER BY created_at DESC, id DESC LIMIT ?").bind(opaqueRef(incidentRef, "incidentRef"), n).all(); return (result?.results || []).map((row) => ({ id: row.id, incidentRef: row.incident_ref, linkedType: row.linked_type, linkedRef: row.linked_ref, relation: row.relation, createdBy: { kind: row.created_by_kind, ref: row.created_by_ref }, createdAt: Number(row.created_at) }));
}

// Environment adapters keep HTTP handlers free of ledger SQL. They are deliberately
// small: the durable tables remain the authority and callers still supply a
// server-resolved principal rather than an actor string from a request body.
function ledgerDb(env) {
  if (!env?.AUTOMATION_DB) fail("AUTOMATION_DB is required", "ledger_db_missing", 503);
  return env.AUTOMATION_DB;
}

export async function readOperationsLedger(env, options = {}) {
  const db = ledgerDb(env);
  const limit = Math.min(Math.max(Number(options.limit) || 25, 1), 100);
  const filters = options.filters || {};
  const [entries, tasks, releases] = await Promise.all([
    listAuditEvents(db, { limit, ...(filters.eventType ? { eventType: filters.eventType } : {}), ...(filters.releaseId ? { releaseId: filters.releaseId } : {}) }),
    listTasks(db, { limit, ...(filters.status ? { status: filters.status } : {}) }),
    listReleases(db, { limit, ...(filters.status && RELEASE_STATUS_SET.has(filters.status) ? { status: filters.status } : {}) }),
  ]);
  let incidents = [];
  try {
    const rows = await prepare(db, "SELECT id, status, severity, title, opened_at, resolved_at FROM ops_incidents ORDER BY opened_at_ms DESC LIMIT ?").bind(limit).all();
    incidents = (rows?.results || []).map((row) => ({ id: row.id, status: row.status, severity: row.severity, title: row.title, openedAt: row.opened_at || null, resolvedAt: row.resolved_at || null }));
  } catch { /* ops visibility schema may be applied independently during source-only rollout */ }
  return { configured: true, generatedAt: new Date().toISOString(), entries, tasks, releases, incidents, nextCursor: null };
}

function provenancePrincipal(provenance) {
  const principal = provenance?.principal;
  return validatePrincipal(principal);
}

export async function ingestOperationsLedgerTask(env, input, provenance) {
  const principal = provenancePrincipal(provenance);
  return createTask(ledgerDb(env), { ...input, principal }, {});
}

export async function ingestOperationsLedgerEvent(env, input, provenance) {
  const principal = provenancePrincipal(provenance);
  return appendAuditEvent(ledgerDb(env), { ...input, principal }, {});
}

export async function ingestOperationsLedgerRelease(env, input, provenance) {
  const principal = provenancePrincipal(provenance);
  return createRelease(ledgerDb(env), { ...input, principal }, {});
}
