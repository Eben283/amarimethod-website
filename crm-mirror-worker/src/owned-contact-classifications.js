// Provider-neutral Staff-owned contact roles and tags.
//
// The production route permits the four reviewed classification commands. The implementation
// appends immutable commands and changes only the `owned:staff` materialized classification rows;
// it has no provider adapter, delivery, payment, appointment, or authority-promotion effect.

export const OWNED_CLASSIFICATION_SOURCE_MODE = "active";
export const OWNED_CLASSIFICATION_CONTRACT_VERSION = "owned-contact-classifications.v1";

const REFERENCE = /^[A-Za-z0-9_-]{1,160}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const TAG = /^[a-z0-9][a-z0-9:_-]{0,79}$/;
const ACTIONS = new Set(["add_tag", "remove_tag", "grant_role", "revoke_role"]);
const ACTORS = new Set(["Eben", "Garrett"]);
const ROLES = new Set(["lead", "client", "affiliate_partner", "referral_source"]);

export class OwnedContactClassificationError extends Error {
  constructor(message, code = "owned_classification_invalid", status = 409) {
    super(message);
    this.name = "OwnedContactClassificationError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code, status = 409) {
  throw new OwnedContactClassificationError(message, code, status);
}

function clean(value) {
  return String(value || "").trim();
}

function normalizedValue(action, input) {
  const raw = clean(input).toLowerCase();
  if (action === "add_tag" || action === "remove_tag") {
    const tag = raw.replace(/\s+/g, "-");
    if (!TAG.test(tag)) fail("valid canonical tag required", "invalid_tag", 400);
    return tag;
  }
  if (!ROLES.has(raw)) fail("recognized contact role required", "invalid_role", 400);
  return raw;
}

function normalize(input) {
  const action = clean(input?.action).toLowerCase();
  const contactId = clean(input?.contactId);
  const actor = clean(input?.actor);
  const idempotencyKey = clean(input?.idempotencyKey);
  if (!ACTIONS.has(action)) fail("recognized classification action required", "invalid_classification_action", 400);
  if (!REFERENCE.test(contactId)) fail("exact contact id required", "invalid_contact_id", 400);
  if (!ACTORS.has(actor)) fail("recognized Staff actor required", "invalid_actor", 400);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) fail("valid idempotency key required", "invalid_idempotency_key", 400);
  return { action, contactId, actor, idempotencyKey, value: normalizedValue(action, input?.value) };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function captureNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function commandDigest(command) {
  return sha256([
    OWNED_CLASSIFICATION_CONTRACT_VERSION,
    command.actor,
    command.idempotencyKey,
    command.action,
    command.contactId,
    command.value,
  ].join("\n"));
}

async function commandByKey(db, actor, idempotencyKey) {
  return db.prepare(
    `SELECT * FROM owned_contact_classification_commands
      WHERE actor = ? AND idempotency_key = ?`,
  ).bind(actor, idempotencyKey).first();
}

function publicCommand(row, deduped) {
  return Object.freeze({
    commandId: row.id,
    contactId: row.contact_id,
    actor: row.actor,
    action: row.action,
    value: row.value_clean,
    resultState: row.result_state,
    recordedAt: row.recorded_at,
    source: "owned:staff",
    deduped,
    providerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    appointmentWrite: false,
    destructiveEvidenceDelete: false,
    authorityPromoted: false,
  });
}

function mapStorageError(error) {
  const message = String(error?.message || error || "");
  if (/no such (?:table|view): owned_contact_classification_/i.test(message)) {
    return new OwnedContactClassificationError("owned classifications are unavailable", "classification_schema_unavailable", 503);
  }
  if (/owned contact classification idempotency conflict/i.test(message)) {
    return new OwnedContactClassificationError(message, "idempotency_conflict", 409);
  }
  if (/owned contact classification contact unavailable/i.test(message)) {
    return new OwnedContactClassificationError(message, "contact_unavailable", 409);
  }
  if (/owned contact classification result mismatch/i.test(message)) {
    return new OwnedContactClassificationError(message, "classification_state_conflict", 409);
  }
  return error;
}

export function ownedContactClassificationReleaseReadiness(mode = OWNED_CLASSIFICATION_SOURCE_MODE) {
  const sourceMode = mode === "active" ? "active" : "shadow";
  return Object.freeze({
    version: OWNED_CLASSIFICATION_CONTRACT_VERSION,
    sourceMode,
    enabled: sourceMode === "active",
    providerFallback: null,
    providerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    appointmentWrite: false,
    destructiveEvidenceDelete: false,
    authorityPromotion: false,
  });
}

export async function captureOwnedContactClassification(db, input, now = new Date().toISOString(), options = {}) {
  const readiness = ownedContactClassificationReleaseReadiness(options.sourceMode ?? OWNED_CLASSIFICATION_SOURCE_MODE);
  if (!readiness.enabled) fail("owned contact classification commands remain source-level shadow", "owned_classification_shadow_only", 503);
  if (!db?.prepare) fail("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const recordedMs = Date.parse(now);
  if (!Number.isFinite(recordedMs)) fail("valid command time required", "invalid_command_time", 400);
  const recordedAt = new Date(recordedMs).toISOString();
  const command = normalize(input);
  if (!await classificationSchemaReady(db)) fail("owned classifications are unavailable", "classification_schema_unavailable", 503);
  const digest = await commandDigest(command);

  const replay = await commandByKey(db, command.actor, command.idempotencyKey);
  if (replay) {
    if (replay.command_sha256 !== digest) fail("idempotency key was already used for another classification command", "idempotency_conflict");
    return publicCommand(replay, true);
  }

  const keyDigest = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const commandId = `oclass_${keyDigest.slice(0, 32)}`;
  const nonce = captureNonce();
  try {
    await db.prepare(
      `INSERT INTO owned_contact_classification_intake (
         id, contact_id, actor, idempotency_key, action, value_clean,
         command_sha256, capture_nonce, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      commandId, command.contactId, command.actor, command.idempotencyKey,
      command.action, command.value, digest, nonce, recordedAt,
    ).run();
  } catch (error) {
    throw mapStorageError(error);
  }

  const captured = await commandByKey(db, command.actor, command.idempotencyKey);
  if (!captured) fail("owned contact classification command was not recorded", "classification_storage_conflict", 500);
  if (captured.command_sha256 !== digest) fail("idempotency key was already used for another classification command", "idempotency_conflict");
  return publicCommand(captured, captured.capture_nonce !== nonce);
}


async function classificationSchemaReady(db) {
  const schema = await db.prepare(`SELECT name FROM sqlite_schema WHERE name IN (
      'owned_contact_classification_commands', 'owned_contact_classification_intake',
      'owned_contact_classification_commands_no_update', 'owned_contact_classification_commands_no_delete',
      'owned_contact_classification_rejects_archived_contact', 'owned_contact_classification_result_guard',
      'owned_contact_classification_apply', 'owned_contact_classification_intake_insert'
    )`).all();
  return schema.results?.length === 8;
}

// Additive provenance; legacy profile tags/roles remain the deduplicated union.
export async function readOwnedContactClassifications(db, contactId) {
  if (!REFERENCE.test(String(contactId || ""))) fail("exact contact id required", "invalid_contact_id", 400);
  const unavailable = { version: OWNED_CLASSIFICATION_CONTRACT_VERSION, state: "unavailable", tags: [], roles: [] };
  try {
    const ready = await classificationSchemaReady(db);
    const tags = await db.prepare("SELECT tag AS value, source FROM contact_tags WHERE contact_id = ? ORDER BY tag, source").bind(contactId).all();
    const roles = await db.prepare("SELECT role AS value, source FROM contact_roles WHERE contact_id = ? ORDER BY role, source").bind(contactId).all();
    return { ...unavailable, state: ready ? "ready" : "unavailable", tags: tags.results || [], roles: roles.results || [] };
  } catch {
    // Unknown provenance never grants browser mutation controls.
    return unavailable;
  }
}

// An observed catalog, not an approved taxonomy. Removed historical command values
// are intentionally absent; only labels currently present in CRM projections appear.
export async function readContactTagCatalog(db, query = '', limit = 100) {
  if (typeof query !== 'string' || query.length > 80) fail('search must be at most 80 characters', 'invalid_tag_search', 400);
  const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 100;
  const unavailable = { version: 'observed-contact-tag-catalog.v1', state: 'unavailable', entries: [], truncated: false };
  try {
    if (!await classificationSchemaReady(db)) return unavailable;
    const terms = query.trim().toLowerCase().split(/[\s:_-]+/).filter(Boolean);
    const where = terms.length ? 'WHERE ' + terms.map(() => 'instr(lower(tag), ?) > 0').join(' AND ') : '';
    const result = await db.prepare(`SELECT tag AS value, source FROM contact_tags ${where}
      GROUP BY tag, source ORDER BY tag COLLATE NOCASE, tag, source LIMIT ?`).bind(...terms, bounded + 1).all();
    const rows = result.results || [];
    return {
      ...unavailable, state: 'ready', truncated: rows.length > bounded,
      entries: rows.slice(0, bounded).map(row => {
        const canonicalValue = String(row.value).trim().toLowerCase().replace(/\s+/g, '-');
        return { value: row.value, source: row.source, canonicalValue, reusable: TAG.test(canonicalValue) };
      }),
    };
  } catch { return unavailable; }
}
