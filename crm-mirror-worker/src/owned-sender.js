// Provider-neutral command seam for Staff-owned communications.
//
// This module deliberately has no delivery adapter. It accepts a staff intent,
// resolves the authoritative contact, destination, consent, and DND state from
// CRM_DB, and atomically appends a command, an outcome, and a Communication
// timeline event. Every command is either policy-blocked or delivery-unavailable;
// it never falls back to GHL and never trusts browser-supplied provider evidence.

export const OWNED_DELIVERY_MODE = "non_delivering_outbox";

export const DELIVERY_PROVIDERS = Object.freeze({
  email: Object.freeze({ candidate: "google-workspace", label: "Google Workspace" }),
  sms: Object.freeze({ candidate: null, label: "Owned SMS provider not selected" }),
});

const COMMAND_FIELDS = new Set(["contactId", "actor", "channel", "idempotencyKey", "subject", "body"]);
const CONTACT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

export class CommunicationCommandError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "CommunicationCommandError";
    this.code = code;
    this.status = status;
  }
}

function latestConsent(consents, channel) {
  return (consents || []).find((consent) => consent.channel === channel && consent.state !== "unknown")?.state || "unknown";
}

function normalizedDnd(value) {
  return ["true", "1", "yes", "on", "dnd"].includes(String(value || "").trim().toLowerCase());
}

function normalizeCommand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CommunicationCommandError("communication command is required", "invalid_command", 400);
  }
  const unknown = Object.keys(input).filter((key) => !COMMAND_FIELDS.has(key));
  if (unknown.length) throw new CommunicationCommandError(`unsupported command fields: ${unknown.join(", ")}`, "unsupported_fields", 400);

  const contactId = String(input.contactId || "").trim();
  const actor = String(input.actor || "").trim();
  const channel = String(input.channel || "").trim().toLowerCase();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  if (!CONTACT_ID.test(contactId)) throw new CommunicationCommandError("invalid contactId", "invalid_contact", 400);
  if (!/^[A-Za-z][A-Za-z .'-]{0,78}$/.test(actor)) throw new CommunicationCommandError("invalid staff actor", "invalid_actor", 400);
  if (channel !== "email" && channel !== "sms") throw new CommunicationCommandError("channel must be email or sms", "invalid_channel", 400);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new CommunicationCommandError("invalid idempotencyKey", "invalid_idempotency_key", 400);
  if (!body || body.length > (channel === "sms" ? 720 : 8000)) throw new CommunicationCommandError("invalid message body", "invalid_body", 400);
  if (BAD_CHARS.test(body)) throw new CommunicationCommandError("message contains invalid characters", "invalid_body", 400);
  if (channel === "email" && (!subject || subject.length > 160 || BAD_CHARS.test(subject))) {
    throw new CommunicationCommandError("invalid email subject", "invalid_subject", 400);
  }
  if (channel === "sms" && subject) throw new CommunicationCommandError("SMS commands cannot include a subject", "invalid_subject", 400);
  return { contactId, actor, channel, idempotencyKey, subject: subject || null, body };
}

export function deliveryReadiness(env = {}) {
  const gmailConfigurationDetected = Boolean(env.PORTAL_KV && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
  return {
    mode: OWNED_DELIVERY_MODE,
    outboxAvailable: false,
    deliveryEnabled: false,
    fallbackProvider: null,
    channels: [
      {
        channel: "email",
        providerCandidate: "google-workspace",
        configurationDetected: gmailConfigurationDetected,
        deliveryEnabled: false,
        state: "unavailable",
        blockers: [
          "staff sender identity is not mapped",
          "delivery command dispatcher is not activated",
          "provider outcomes are not ingested into Communication",
        ],
      },
      {
        channel: "sms",
        providerCandidate: null,
        configurationDetected: false,
        deliveryEnabled: false,
        state: "unavailable",
        blockers: [
          "owned SMS provider and sending number are not selected",
          "delivery command dispatcher is not implemented",
          "delivery and reply webhooks are not ingested into Communication",
        ],
      },
    ],
    safeguards: [
      "signed staff session",
      "same-origin command request",
      "server-derived contact destination, channel opt-out, and DND",
      "idempotent append-only command and outcome ledger",
      "no GHL fallback",
    ],
  };
}

export async function communicationReadiness(db, env = {}) {
  const readiness = deliveryReadiness(env);
  if (!db) return { ...readiness, outboxBlockers: ["CRM command storage is not bound"] };
  try {
    await db.prepare(
      `SELECT idempotency_key, message_ref, delivery_state
         FROM outbound_delivery_attempts LIMIT 0`,
    ).bind().first();
    return { ...readiness, outboxAvailable: true, outboxBlockers: [] };
  } catch {
    return { ...readiness, outboxBlockers: ["owned communication command migration is not available"] };
  }
}

export function evaluateDeliveryEligibility({ contact, consents, channel, dnd }) {
  if (!Object.hasOwn(DELIVERY_PROVIDERS, channel)) throw new Error("unsupported delivery channel");
  const destination = channel === "email" ? contact?.email_normalized : contact?.phone_e164;
  const consentState = latestConsent(consents, channel);
  const reasons = [];
  if (!destination) reasons.push("missing_destination");
  if (consentState === "revoked") reasons.push("channel_opted_out");
  if (normalizedDnd(dnd)) reasons.push("do_not_disturb");
  return {
    channel,
    provider: "unassigned",
    consentState,
    policyEligible: reasons.length === 0,
    deliveryAllowed: false,
    reasons,
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function maskDestination(channel, value) {
  if (!value) return null;
  if (channel === "sms") return `***${String(value).replace(/\D/g, "").slice(-4)}`;
  const [local, domain] = String(value).split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

async function commandContact(db, contactId) {
  return db.prepare(
    `SELECT contact.id, contact.display_name, contact.email_normalized, contact.phone_e164,
            COALESCE((SELECT attribute_value FROM contact_attributes
                      WHERE contact_id = contact.id AND attribute_key = 'system.dnd'
                      ORDER BY datetime(updated_at) DESC LIMIT 1), 'off') AS dnd_state,
            COALESCE((SELECT state FROM consents WHERE contact_id = contact.id AND channel = 'email' AND state <> 'unknown'
                      ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1), 'unknown') AS email_consent_state,
            COALESCE((SELECT state FROM consents WHERE contact_id = contact.id AND channel = 'sms' AND state <> 'unknown'
                      ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1), 'unknown') AS sms_consent_state
       FROM contacts contact WHERE contact.id = ?`,
  ).bind(contactId).first();
}

function commandResult(row, deduped) {
  return {
    commandId: row.id,
    messageRef: row.message_ref,
    contactId: row.contact_id,
    actor: row.actor,
    channel: row.channel,
    policyState: row.policy_state,
    deliveryState: row.delivery_state,
    consentState: row.consent_state,
    dndState: row.dnd_state,
    destinationMasked: row.destination_masked,
    deliveryEnabled: false,
    deduped,
  };
}

// The module's deep interface: one command in, one durable non-delivery result
// out. Contact hydration, policy evaluation, stable references, idempotency, and
// all three append-only records remain local to this implementation.
export async function captureCommunicationCommand(db, input, now = new Date().toISOString()) {
  if (!db) throw new CommunicationCommandError("communication storage is unavailable", "storage_unavailable", 500);
  const command = normalizeCommand(input);
  const contact = await commandContact(db, command.contactId);
  if (!contact) throw new CommunicationCommandError("contact not found", "contact_not_found", 404);

  const consents = [
    { channel: "email", state: contact.email_consent_state || "unknown" },
    { channel: "sms", state: contact.sms_consent_state || "unknown" },
  ];
  const eligibility = evaluateDeliveryEligibility({ contact, consents, channel: command.channel, dnd: contact.dnd_state });
  const deliveryState = eligibility.policyEligible ? "not_sent_delivery_unavailable" : "not_sent_policy_blocked";
  const policyState = eligibility.policyEligible ? "eligible" : "blocked";
  const destination = command.channel === "email" ? contact.email_normalized : contact.phone_e164;
  const destinationMasked = maskDestination(command.channel, destination);
  const contentHash = await sha256(`${command.channel}\n${command.subject || ""}\n${command.body}`);
  const commandKeyHash = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const commandId = `cmd_${commandKeyHash.slice(0, 24)}`;
  const messageRef = `msg_${commandKeyHash.slice(0, 24)}`;
  const outcomeId = `out_${commandKeyHash.slice(0, 24)}`;
  const detail = JSON.stringify({
    messageRef,
    reasons: eligibility.reasons,
    deliveryEnabled: false,
    fallbackProvider: null,
  });

  const results = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO outbound_delivery_attempts
       (id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at,
        idempotency_key, message_ref, subject_clean, body_clean, dnd_state, destination_masked, delivery_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(commandId, command.contactId, command.actor, command.channel, "unassigned", eligibility.consentState, policyState, contentHash, now,
      command.idempotencyKey, messageRef, command.subject, command.body, normalizedDnd(contact.dnd_state) ? "on" : "off", destinationMasked, deliveryState),
    db.prepare(
      `INSERT OR IGNORE INTO outbound_delivery_events (id, attempt_id, event_type, detail_json, occurred_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(outcomeId, commandId, deliveryState, detail, now),
    db.prepare(
      `INSERT OR IGNORE INTO communication_events
       (id, thread_id, contact_id, provider, provider_event_id, event_kind, direction, delivery_status,
        subject, body_clean, occurred_at, sender_label, created_at, updated_at)
       VALUES (?, NULL, ?, 'owned_outbox', ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(messageRef, command.contactId, messageRef, command.channel, deliveryState, command.subject, command.body, now, command.actor, now, now),
  ]);

  const stored = await db.prepare(
    `SELECT id, contact_id, actor, channel, consent_state, policy_state, content_sha256, created_at,
            idempotency_key, message_ref, dnd_state, destination_masked, delivery_state
       FROM outbound_delivery_attempts WHERE actor = ? AND idempotency_key = ?`,
  ).bind(command.actor, command.idempotencyKey).first();
  if (!stored) throw new CommunicationCommandError("communication command was not recorded", "storage_failure", 500);
  if (stored.content_sha256 !== contentHash || stored.contact_id !== command.contactId || stored.channel !== command.channel) {
    throw new CommunicationCommandError("idempotency key was already used for a different command", "idempotency_conflict", 409);
  }
  return commandResult(stored, Number(results?.[0]?.meta?.changes || 0) === 0);
}

// Kept for the already-applied 0010 foundation and migration verification. No
// browser route invokes it; new code should use captureCommunicationCommand.
export async function recordShadowDeliveryAttempt(db, { contactId, actor, channel, contact, consents, dnd, content }, now) {
  const safeActor = String(actor || "").trim();
  if (!contactId || !safeActor) throw new Error("contactId and actor are required");
  const eligibility = evaluateDeliveryEligibility({ contact, consents, channel, dnd });
  const attemptId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const contentHash = await sha256(content);
  await db.batch([
    db.prepare(
      `INSERT INTO outbound_delivery_attempts
       (id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(attemptId, contactId, safeActor, channel, "unassigned", eligibility.consentState, eligibility.policyEligible ? "eligible" : "blocked", contentHash, now),
    db.prepare(
      `INSERT INTO outbound_delivery_events (id, attempt_id, event_type, detail_json, occurred_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(eventId, attemptId, "shadow_evaluated", JSON.stringify({ reasons: eligibility.reasons, deliveryAllowed: false }), now),
  ]);
  return { attemptId, ...eligibility };
}
