// Provider-neutral Staff ownership for contact names and exact communication destinations.
//
// Production is source-pinned shadow. Tests can exercise the separately reviewable active path;
// that path appends immutable before/after evidence and updates only the selected field family.
// A destination change must carry consent for that exact normalized email/phone, preventing a
// grant observed for an old address from silently authorizing a new one.

export const OWNED_CONTACT_PROFILE_SOURCE_MODE = "shadow";
export const OWNED_CONTACT_PROFILE_CONTRACT_VERSION = "owned-contact-profile-authority.v1";

const ACTIONS = new Set(["revise_name", "set_email", "set_phone"]);
const ACTORS = new Set(["Eben", "Garrett"]);
const CONSENT_STATES = new Set(["granted", "revoked", "unknown"]);
const REFERENCE = /^[A-Za-z0-9_-]{1,160}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export class OwnedContactProfileError extends Error {
  constructor(message, code = "owned_contact_profile_invalid", status = 409) {
    super(message);
    this.name = "OwnedContactProfileError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code, status = 409) {
  throw new OwnedContactProfileError(message, code, status);
}

function clean(value) {
  return String(value ?? "").trim();
}

function nullableClean(value) {
  const normalized = clean(value);
  return normalized || null;
}

function normalizedName(value, field) {
  const result = nullableClean(value);
  if (result && result.length > 100) fail(`${field} is too long`, `invalid_${field}`, 400);
  return result;
}

function normalizedEmail(value) {
  const result = nullableClean(value)?.toLowerCase() || null;
  if (result && (result.length > 254 || !EMAIL.test(result))) fail("valid email required", "invalid_email", 400);
  return result;
}

function normalizedPhone(value) {
  const raw = nullableClean(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const result = raw.startsWith("+") ? `+${digits}`
    : digits.length === 10 ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : raw;
  if (!E164.test(result)) fail("valid E.164 phone required", "invalid_phone", 400);
  return result;
}

function normalize(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("contact profile command required", "invalid_profile_command", 400);
  }
  const action = clean(input.action).toLowerCase();
  const contactId = clean(input.contactId);
  const actor = clean(input.actor);
  const idempotencyKey = clean(input.idempotencyKey);
  const expectedRevision = Number(input.expectedRevision);
  if (!ACTIONS.has(action)) fail("recognized profile action required", "invalid_profile_action", 400);
  if (!REFERENCE.test(contactId)) fail("exact contact id required", "invalid_contact_id", 400);
  if (!ACTORS.has(actor)) fail("recognized Staff actor required", "invalid_actor", 403);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) fail("valid idempotency key required", "invalid_idempotency_key", 400);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    fail("exact non-negative revision required", "invalid_expected_revision", 400);
  }

  if (action === "revise_name") {
    const firstName = normalizedName(input.firstName, "first_name");
    const lastName = normalizedName(input.lastName, "last_name");
    if (!firstName && !lastName) fail("first or last name required", "invalid_name", 400);
    return Object.freeze({
      action, contactId, actor, idempotencyKey, expectedRevision,
      firstName, lastName, displayName: [firstName, lastName].filter(Boolean).join(" "),
      destination: null, consentState: null, consentEvidenceRef: null,
    });
  }

  const destination = action === "set_email" ? normalizedEmail(input.email) : normalizedPhone(input.phone);
  if (!destination) {
    if (input.consentState != null || input.consentEvidenceRef != null) {
      fail("removed destination cannot carry consent", "invalid_destination_consent", 400);
    }
    return Object.freeze({
      action, contactId, actor, idempotencyKey, expectedRevision,
      firstName: null, lastName: null, displayName: null,
      destination: null, consentState: null, consentEvidenceRef: null,
    });
  }
  const consentState = clean(input.consentState).toLowerCase();
  const consentEvidenceRef = nullableClean(input.consentEvidenceRef);
  if (!CONSENT_STATES.has(consentState)) {
    fail("explicit destination consent state required", "invalid_destination_consent", 400);
  }
  if (consentEvidenceRef && consentEvidenceRef.length > 240) {
    fail("consent evidence reference is too long", "invalid_consent_evidence", 400);
  }
  if (consentState === "granted" && !consentEvidenceRef) {
    fail("granted destination requires evidence", "missing_consent_evidence", 400);
  }
  return Object.freeze({
    action, contactId, actor, idempotencyKey, expectedRevision,
    firstName: null, lastName: null, displayName: null,
    destination, consentState, consentEvidenceRef,
  });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value ?? "")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function captureNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function commandDigest(command) {
  return sha256([
    OWNED_CONTACT_PROFILE_CONTRACT_VERSION,
    command.actor,
    command.idempotencyKey,
    command.action,
    command.contactId,
    command.expectedRevision,
    command.firstName ?? "",
    command.lastName ?? "",
    command.displayName ?? "",
    command.destination ?? "",
    command.consentState ?? "",
    command.consentEvidenceRef ?? "",
  ].join("\n"));
}

function commandByKey(db, actor, idempotencyKey) {
  return db.prepare(
    `SELECT * FROM owned_contact_profile_commands
      WHERE actor = ? AND idempotency_key = ?`,
  ).bind(actor, idempotencyKey).first();
}

async function currentContact(db, contactId, action, destination, destinationSha256) {
  const channel = action === "set_email" ? "email" : "sms";
  return db.prepare(
    `SELECT contact.*,
            CASE WHEN ? IN ('set_email', 'set_phone') AND ? IS NOT NULL THEN
              (SELECT consent.state FROM consents consent
                WHERE consent.contact_id = contact.id
                  AND consent.channel = ?
                  AND consent.destination_normalized = ?
                  AND consent.destination_sha256 = ?
                ORDER BY datetime(consent.effective_at) DESC, consent.id DESC LIMIT 1)
            ELSE NULL END AS exact_destination_consent_state
       FROM contacts contact WHERE contact.id = ?`,
  ).bind(action, destinationSha256, channel, destination, destinationSha256, contactId).first();
}

function mapStorageError(error) {
  const message = String(error?.message || error || "");
  if (/owned contact profile contact unavailable/i.test(message)) {
    return new OwnedContactProfileError(message, "contact_unavailable", 409);
  }
  if (/owned contact profile stale revision/i.test(message)) {
    return new OwnedContactProfileError(message, "stale_profile_revision", 409);
  }
  if (/owned contact profile result mismatch|result revision mismatch|previous guard/i.test(message)) {
    return new OwnedContactProfileError(message, "profile_state_conflict", 409);
  }
  if (/UNIQUE constraint failed: owned_contact_profile_commands\.actor, owned_contact_profile_commands\.idempotency_key/i.test(message)) {
    return new OwnedContactProfileError(message, "idempotency_conflict", 409);
  }
  return error;
}

function publicCommand(row, deduped) {
  const channel = row.action === "set_email" ? "email" : row.action === "set_phone" ? "sms" : null;
  return Object.freeze({
    commandId: row.id,
    contactId: row.contact_id,
    actor: row.actor,
    action: row.action,
    expectedRevision: Number(row.expected_revision),
    resultRevision: Number(row.result_revision),
    resultState: row.result_state,
    authority: row.result_state === "applied" ? "owned" : row.previous_authority,
    channel,
    destinationMasked: channel ? maskDestination(channel, row.next_destination_normalized) : null,
    displayName: row.action === "revise_name" ? row.next_display_name : null,
    consentState: row.consent_state,
    recordedAt: row.recorded_at,
    source: "owned:staff",
    deduped,
    providerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    appointmentWrite: false,
    contactCreated: false,
    destructiveEvidenceDelete: false,
  });
}

function maskDestination(channel, value) {
  if (!value) return null;
  if (channel === "sms") return `***${String(value).replace(/\D/g, "").slice(-4)}`;
  const [local, domain] = String(value).split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

export function ownedContactProfileReleaseReadiness(mode = OWNED_CONTACT_PROFILE_SOURCE_MODE) {
  const sourceMode = mode === "active" ? "active" : "shadow";
  return Object.freeze({
    version: OWNED_CONTACT_PROFILE_CONTRACT_VERSION,
    sourceMode,
    enabled: sourceMode === "active",
    providerFallback: null,
    providerWrite: false,
    messageWrite: false,
    paymentWrite: false,
    appointmentWrite: false,
    contactCreation: false,
    destructiveEvidenceDelete: false,
    destinationConsentRequired: true,
    independentFieldRevisions: true,
  });
}

export async function captureOwnedContactProfile(db, rawInput, now = new Date().toISOString(), options = {}) {
  const readiness = ownedContactProfileReleaseReadiness(options.sourceMode ?? OWNED_CONTACT_PROFILE_SOURCE_MODE);
  if (!readiness.enabled) fail("owned contact profile commands remain source-level shadow", "owned_contact_profile_shadow_only", 503);
  if (!db?.prepare) fail("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const recordedMs = Date.parse(now);
  if (!Number.isFinite(recordedMs)) fail("valid command time required", "invalid_command_time", 400);
  const recordedAt = new Date(recordedMs).toISOString();
  const command = normalize(rawInput);
  const digest = await commandDigest(command);
  const replay = await commandByKey(db, command.actor, command.idempotencyKey);
  if (replay) {
    if (replay.command_sha256 !== digest) fail("idempotency key was reused", "idempotency_conflict", 409);
    return publicCommand(replay, true);
  }

  const destinationSha256 = command.destination ? await sha256(command.destination) : null;
  const contact = await currentContact(db, command.contactId, command.action, command.destination, destinationSha256);
  if (!contact || contact.archived_at) fail("contact is unavailable", "contact_unavailable", 409);
  const revision = command.action === "revise_name" ? Number(contact.name_revision)
    : command.action === "set_email" ? Number(contact.email_revision) : Number(contact.phone_revision);
  const previousAuthority = command.action === "revise_name" ? contact.name_authority
    : command.action === "set_email" ? contact.email_authority : contact.phone_authority;
  if (revision !== command.expectedRevision) fail("contact profile revision is stale", "stale_profile_revision", 409);

  const alreadyCurrent = command.action === "revise_name"
    ? previousAuthority === "owned"
      && contact.first_name === command.firstName
      && contact.last_name === command.lastName
      && contact.display_name === command.displayName
    : previousAuthority === "owned"
      && (command.action === "set_email" ? contact.email_normalized : contact.phone_e164) === command.destination
      && (command.destination === null || contact.exact_destination_consent_state === command.consentState);
  const resultState = alreadyCurrent ? "already_current" : "applied";
  const resultRevision = command.expectedRevision + (alreadyCurrent ? 0 : 1);
  const keyDigest = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const commandId = `ocprof_${keyDigest.slice(0, 32)}`;
  const values = {
    previousFirstName: command.action === "revise_name" ? contact.first_name : null,
    previousLastName: command.action === "revise_name" ? contact.last_name : null,
    previousDisplayName: command.action === "revise_name" ? contact.display_name : null,
    previousDestination: command.action === "set_email" ? contact.email_normalized
      : command.action === "set_phone" ? contact.phone_e164 : null,
  };

  try {
    await db.prepare(
      `INSERT INTO owned_contact_profile_commands (
         id, contact_id, actor, idempotency_key, action, expected_revision, result_revision,
         previous_authority, previous_first_name, previous_last_name, previous_display_name,
         previous_destination_normalized, next_first_name, next_last_name, next_display_name,
         next_destination_normalized, consent_state, consent_evidence_ref, destination_sha256,
         command_sha256, capture_nonce, result_state, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      commandId, command.contactId, command.actor, command.idempotencyKey, command.action,
      command.expectedRevision, resultRevision, previousAuthority,
      values.previousFirstName, values.previousLastName, values.previousDisplayName,
      values.previousDestination, command.firstName, command.lastName, command.displayName,
      command.destination, command.consentState, command.consentEvidenceRef, destinationSha256,
      digest, captureNonce(), resultState, recordedAt,
    ).run();
  } catch (error) {
    const concurrent = await commandByKey(db, command.actor, command.idempotencyKey).catch(() => null);
    if (concurrent) {
      if (concurrent.command_sha256 !== digest) fail("idempotency key was reused", "idempotency_conflict", 409);
      return publicCommand(concurrent, true);
    }
    throw mapStorageError(error);
  }
  const stored = await commandByKey(db, command.actor, command.idempotencyKey);
  if (!stored || stored.command_sha256 !== digest) fail("profile command was not recorded", "profile_storage_conflict", 500);
  return publicCommand(stored, false);
}
