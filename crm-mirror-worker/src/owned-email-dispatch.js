// Owned Staff email command and dormant dispatcher.
//
// The source gate is intentionally immutable and shadow-only in this revision. Environment
// variables cannot override it. Unit tests can exercise the separately reviewable active path by
// passing `sourceMode: "active"`; production callers use the default and therefore perform no DB
// queue read and no provider call. There is no GHL fallback and no SMS adapter.

import { recordGmailProviderSubmission } from "./gmail-submission.js";
import { sendGmailEmail } from "./gmail.js";
import {
  captureCommunicationCommand,
  CommunicationCommandError,
  evaluateDeliveryEligibility,
  loadCommunicationContact,
  maskCommunicationDestination,
  normalizeCommunicationCommand,
} from "./owned-sender.js";

export const OWNED_EMAIL_SOURCE_MODE = "shadow";
const RELEASE_FLAG = "approved";
const ACTORS = new Set(["Eben", "Garrett"]);
const DEFAULT_LIMIT = 10;
const MAX_ATTEMPTS = 12;
const LEASE_MS = 120_000;

function changes(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sourceMode(value) { return value === "active" ? "active" : "shadow"; }

function actorAllowlist(env) {
  if (env?.OWNED_EMAIL_DELIVERY_RELEASE !== RELEASE_FLAG) return [];
  let parsed;
  try { parsed = JSON.parse(env?.OWNED_EMAIL_ACTOR_ALLOWLIST || ""); } catch { return []; }
  if (!Array.isArray(parsed) || parsed.some((actor) => typeof actor !== "string" || !ACTORS.has(actor))) return [];
  return [...new Set(parsed)];
}

export function ownedEmailDeliveryReleaseReadiness(env = {}, mode = OWNED_EMAIL_SOURCE_MODE) {
  const allowlist = actorAllowlist(env);
  const source = sourceMode(mode);
  return {
    sourceMode: source,
    releaseApproved: env?.OWNED_EMAIL_DELIVERY_RELEASE === RELEASE_FLAG,
    actorAllowlistValid: allowlist.length > 0,
    allowedActors: allowlist,
    enabled: source === "active" && allowlist.length > 0,
    fallbackProvider: null,
    provider: "google-workspace",
    receiptState: "provider_submission_only",
    terminalDeliveryEvidence: false,
  };
}

function commandReadModel(row, deduped) {
  return Object.freeze({
    commandId: row.id,
    contactId: row.contact_id,
    actor: row.actor,
    channel: row.channel,
    state: row.state,
    policyState: row.policy_state,
    consentState: row.consent_state,
    dndState: row.dnd_state,
    destinationMasked: row.destination_masked,
    deliveryEnabled: false,
    deduped,
  });
}

export async function captureOwnedEmailCommand(db, input, now = new Date().toISOString(), options = {}) {
  if (!db) throw new CommunicationCommandError("communication storage is unavailable", "storage_unavailable", 500);
  const command = normalizeCommunicationCommand(input);
  if (command.channel !== "email") {
    throw new CommunicationCommandError("owned email command accepts email only", "unsupported_channel", 400);
  }
  if (!ACTORS.has(command.actor)) {
    throw new CommunicationCommandError("signed actor does not own an Amari mailbox", "unsupported_actor", 403);
  }
  const contact = await loadCommunicationContact(db, command.contactId);
  if (!contact) throw new CommunicationCommandError("contact not found", "contact_not_found", 404);
  const consentState = contact.email_consent_state || "unknown";
  const eligibility = evaluateDeliveryEligibility({
    contact,
    consents: [{ channel: "email", state: consentState }],
    channel: "email",
    dnd: contact.dnd_state,
  });
  const mode = sourceMode(options.sourceMode ?? OWNED_EMAIL_SOURCE_MODE);
  const state = !eligibility.policyEligible ? "policy_blocked" : mode === "active" ? "pending" : "shadow_blocked";
  const contentSha256 = await sha256(`email\n${command.subject}\n${command.body}`);
  const commandKey = await sha256(`${command.actor}\n${command.idempotencyKey}`);
  const commandId = `ocom_${commandKey.slice(0, 32)}`;
  const destinationMasked = maskCommunicationDestination("email", contact.email_normalized);
  const eventId = `ocde_${commandKey.slice(0, 32)}_captured`;
  const dndState = ["true", "1", "yes", "on", "dnd"].includes(String(contact.dnd_state || "").trim().toLowerCase()) ? "on" : "off";
  const detail = JSON.stringify({ state, reasons: eligibility.reasons, sourceMode: mode, deliveryEnabled: false });

  const results = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO owned_communication_commands
       (id, contact_id, actor, channel, provider, idempotency_key, subject_clean, body_clean,
        content_sha256, consent_state, policy_state, dnd_state, destination_masked, captured_at)
       VALUES (?, ?, ?, 'email', 'google_workspace', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(commandId, command.contactId, command.actor, command.idempotencyKey, command.subject, command.body,
      contentSha256, consentState, eligibility.policyEligible ? "eligible" : "blocked", dndState, destinationMasked, now),
    db.prepare(
      `INSERT OR IGNORE INTO owned_communication_dispatches
       (command_id, payload_sha256, state, attempts, lease_until, updated_at)
       VALUES (?, ?, ?, 0, 0, ?)`,
    ).bind(commandId, contentSha256, state, now),
    db.prepare(
      `INSERT OR IGNORE INTO owned_communication_dispatch_events
       (id, command_id, event_type, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(eventId, commandId, state, detail, now),
  ]);
  const stored = await db.prepare(
    `SELECT command.id, command.contact_id, command.actor, command.channel, command.idempotency_key,
            command.content_sha256, command.policy_state, command.consent_state, command.dnd_state,
            command.destination_masked, dispatch.state
       FROM owned_communication_commands command
       JOIN owned_communication_dispatches dispatch ON dispatch.command_id = command.id
      WHERE command.actor = ? AND command.idempotency_key = ?`,
  ).bind(command.actor, command.idempotencyKey).first();
  if (!stored) throw new CommunicationCommandError("owned email command was not recorded", "storage_failure", 500);
  if (stored.contact_id !== command.contactId || stored.channel !== "email" || stored.content_sha256 !== contentSha256) {
    throw new CommunicationCommandError("idempotency key was already used for a different command", "idempotency_conflict", 409);
  }
  return commandReadModel(stored, changes(results?.[0]) === 0);
}

// The live route uses this source-controlled switch. In the reviewed shadow build every Staff
// command retains the existing append-only not-sent behavior. A future activation must change the
// committed constant and therefore pass review before newly captured email commands can queue.
export async function captureStaffCommunicationCommand(db, input, now = new Date().toISOString()) {
  if (OWNED_EMAIL_SOURCE_MODE === "active" && String(input?.channel || "").toLowerCase() === "email") {
    return captureOwnedEmailCommand(db, input, now, { sourceMode: "active" });
  }
  return captureCommunicationCommand(db, input, now);
}

async function claim(db, row, nowMs) {
  const now = new Date(nowMs).toISOString();
  const result = await db.prepare(
    `UPDATE owned_communication_dispatches
        SET state = 'executing', attempts = attempts + 1, lease_until = ?, last_error_code = NULL, updated_at = ?
      WHERE command_id = ? AND state IN ('pending', 'retryable')`,
  ).bind(nowMs + LEASE_MS, now, row.command_id).run();
  if (changes(result) !== 1) return null;
  return db.prepare(
    `SELECT dispatch.*, command.contact_id, command.actor, command.channel, command.provider,
            command.subject_clean, command.body_clean, command.content_sha256,
            contact.email_normalized, contact.archived_at,
            COALESCE((SELECT attribute_value FROM contact_attributes
                      WHERE contact_id = contact.id AND attribute_key = 'system.dnd'
                      ORDER BY datetime(updated_at) DESC LIMIT 1), 'off') AS current_dnd_state,
            COALESCE((SELECT state FROM consents
                      WHERE contact_id = contact.id AND channel = 'email' AND state <> 'unknown'
                      ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1), 'unknown') AS current_consent_state
       FROM owned_communication_dispatches dispatch
       JOIN owned_communication_commands command ON command.id = dispatch.command_id
       JOIN contacts contact ON contact.id = command.contact_id
      WHERE dispatch.command_id = ?`,
  ).bind(row.command_id).first();
}

async function checkpointFailure(db, row, state, code, now) {
  const cleanCode = String(code || "dispatch_failed").slice(0, 120);
  const results = await db.batch([
    db.prepare(
      `UPDATE owned_communication_dispatches
          SET state = ?, lease_until = 0, last_error_code = ?, updated_at = ?
        WHERE command_id = ? AND state = 'executing'`,
    ).bind(state, cleanCode, now, row.command_id),
    db.prepare(
      `INSERT INTO owned_communication_dispatch_events
       (id, command_id, event_type, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(`ocde_${crypto.randomUUID()}`, row.command_id, state, JSON.stringify({ code: cleanCode }), now),
  ]);
  if (changes(results?.[0]) !== 1) throw new Error("owned email failure checkpoint changed");
  return state;
}

async function checkpointSubmission(db, row, providerMessageId, receiptState, now) {
  const state = receiptState === "submitted" ? "submitted" : "submission_unreconciled";
  const results = await db.batch([
    db.prepare(
      `UPDATE owned_communication_dispatches
          SET state = ?, lease_until = 0, provider_message_id = ?, submitted_at = ?,
              last_error_code = ?, updated_at = ?
        WHERE command_id = ? AND state = 'executing'`,
    ).bind(state, providerMessageId, now, state === "submission_unreconciled" ? "submission_evidence_unreconciled" : null,
      now, row.command_id),
    db.prepare(
      `INSERT INTO owned_communication_dispatch_events
       (id, command_id, event_type, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(`ocde_${crypto.randomUUID()}`, row.command_id, state,
      JSON.stringify({ receiptState: state, terminalDeliveryEvidence: false }), now),
  ]);
  if (changes(results?.[0]) !== 1) throw new Error("owned email submission checkpoint changed");
  return state;
}

export async function dispatchOwnedEmails(env, nowMs = Date.now(), limit = DEFAULT_LIMIT, options = {}) {
  const readiness = ownedEmailDeliveryReleaseReadiness(env, options.sourceMode ?? OWNED_EMAIL_SOURCE_MODE);
  if (!readiness.enabled) {
    return { status: "disabled", considered: 0, submitted: 0, retryable: 0, manualReview: 0, unreconciled: 0, readiness };
  }
  if (!env?.CRM_DB) throw new Error("CRM_DB is required for owned email dispatch");
  const bounded = Math.max(1, Math.min(25, Number(limit) || DEFAULT_LIMIT));
  const candidates = (await env.CRM_DB.prepare(
    `SELECT command_id FROM owned_communication_dispatches
      WHERE state IN ('pending', 'retryable')
      ORDER BY datetime(updated_at), command_id LIMIT ?`,
  ).bind(bounded).all()).results || [];
  const summary = { status: "succeeded", considered: candidates.length, submitted: 0, retryable: 0, manualReview: 0, unreconciled: 0, readiness };
  const send = options.sendGmailEmail || sendGmailEmail;
  const recordSubmission = options.recordSubmission || recordGmailProviderSubmission;
  for (const candidate of candidates) {
    const row = await claim(env.CRM_DB, candidate, nowMs);
    if (!row) continue;
    const now = new Date(nowMs).toISOString();
    try {
      if (!readiness.allowedActors.includes(row.actor)) {
        await checkpointFailure(env.CRM_DB, row, "manual_review", "actor_not_released", now);
        summary.manualReview += 1;
        continue;
      }
      if (row.archived_at) {
        await checkpointFailure(env.CRM_DB, row, "manual_review", "contact_archived", now);
        summary.manualReview += 1;
        continue;
      }
      const digest = await sha256(`email\n${row.subject_clean}\n${row.body_clean}`);
      if (digest !== row.payload_sha256 || digest !== row.content_sha256) {
        await checkpointFailure(env.CRM_DB, row, "manual_review", "payload_digest_mismatch", now);
        summary.manualReview += 1;
        continue;
      }
      const current = evaluateDeliveryEligibility({
        contact: { email_normalized: row.email_normalized },
        consents: [{ channel: "email", state: row.current_consent_state }],
        channel: "email",
        dnd: row.current_dnd_state,
      });
      if (!current.policyEligible) {
        await checkpointFailure(env.CRM_DB, row, "manual_review", `policy_changed_${current.reasons.join("_")}`, now);
        summary.manualReview += 1;
        continue;
      }
      let result;
      try {
        result = await send(env, {
          actor: row.actor,
          to: row.email_normalized,
          subject: row.subject_clean,
          text: row.body_clean,
        });
      } catch (error) {
        const state = error?.retryable === true && Number(row.attempts) < MAX_ATTEMPTS ? "retryable" : "manual_review";
        await checkpointFailure(env.CRM_DB, row, state, error?.retryable === true ? "provider_temporarily_unavailable" : "provider_submission_failed", now);
        summary[state === "retryable" ? "retryable" : "manualReview"] += 1;
        continue;
      }
      if (!result?.id) throw new Error("Google Workspace did not return a submission reference");
      let receiptState = "submitted";
      try {
        await recordSubmission(env.CRM_DB, {
          mailboxActor: row.actor,
          grantOwner: `${row.actor.toLowerCase()}@amarimethod.com`,
          submissionRef: row.command_id,
          contactId: row.contact_id,
          providerMessageId: String(result.id),
          gmailThreadId: result.threadId ? String(result.threadId) : null,
          rfcMessageId: null,
          subject: row.subject_clean,
          body: row.body_clean,
          submittedAt: now,
        });
      } catch {
        receiptState = "submission_unreconciled";
      }
      await checkpointSubmission(env.CRM_DB, row, String(result.id), receiptState, now);
      summary[receiptState === "submitted" ? "submitted" : "unreconciled"] += 1;
    } catch (error) {
      // A row already in executing is never automatically reclaimed. If Gmail may have accepted
      // the message, leaving it stuck is safer than issuing a duplicate. Readiness reports it.
      await checkpointFailure(env.CRM_DB, row, "manual_review", "dispatch_checkpoint_failed", now).catch(() => {});
      summary.manualReview += 1;
    }
  }
  if (summary.retryable || summary.manualReview || summary.unreconciled) summary.status = "attention";
  return summary;
}

export async function ownedEmailDispatchReadiness(db, env = {}, mode = OWNED_EMAIL_SOURCE_MODE) {
  const release = ownedEmailDeliveryReleaseReadiness(env, mode);
  if (!db) return { configured: false, state: "unavailable", deliveryEnabled: false, release, reason: "CRM_DB is unavailable" };
  try {
    const rows = (await db.prepare(
      "SELECT state, COUNT(*) AS count FROM owned_communication_dispatches GROUP BY state",
    ).all()).results || [];
    const states = ["pending", "executing", "retryable", "submitted", "submission_unreconciled", "policy_blocked", "shadow_blocked", "manual_review"];
    const counts = Object.fromEntries(states.map((state) => [state, 0]));
    for (const row of rows) counts[row.state] = Number(row.count || 0);
    const attention = counts.executing + counts.retryable + counts.submission_unreconciled + counts.manual_review;
    return {
      configured: true,
      state: attention ? "attention" : counts.pending ? "pending" : "ready",
      deliveryEnabled: release.enabled,
      counts,
      attention,
      release,
      terminalSuccessModel: "not_available_from_gmail_submission",
    };
  } catch (error) {
    return { configured: false, state: "unavailable", deliveryEnabled: false, release, reason: error?.message || String(error) };
  }
}
