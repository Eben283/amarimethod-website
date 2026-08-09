// Pure Gmail evidence ingestion and read projections.
//
// This module owns no OAuth material and performs no Gmail API call, watch
// registration, webhook handling, dispatch, compose action, or GHL fallback.
// Callers must hand it already-observed provider evidence. Only evidence with
// an exact server-side contact attribution reaches Communication; everything
// else remains visible in the review ledger.

const ACTORS = new Set(["Eben", "Garrett"]);
const OUTCOMES = new Set(["accepted", "failed", "bounced"]);
const MAILBOX_FIELDS = new Set(["mailboxActor", "grantOwner"]);
const BAD_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const IDENTIFIER = /^[A-Za-z0-9@._:+<>\/-]{1,512}$/;
const PROVIDER_FIELDS = new Set([
  "kind", "providerEventId", "outcome", "providerMessageId",
  "gmailThreadId", "rfcMessageId", "submissionRef", "historyId", "failureCode",
  "failureDetail", "occurredAt",
]);
const INBOUND_FIELDS = new Set([
  "kind", "providerMessageId", "gmailThreadId", "rfcMessageId",
  "inReplyTo", "references", "mailboxAddress", "fromAddress", "toAddresses", "subject", "body",
  "historyId", "receivedAt",
]);
const HISTORY_FIELDS = new Set(["kind", "mailboxAddress", "historyId", "observedAt"]);
const SYNC_GAP_FIELDS = new Set([
  "kind", "mailboxAddress", "providerMessageId", "historyId", "reason", "observedAt",
]);
const SYNC_GAP_REASONS = new Map([
  ["gmail_message_missing", "provider_message_missing"],
  ["gmail_body_truncated", "body_truncated"],
]);

export class GmailEvidenceError extends Error {
  constructor(message, code = "invalid_evidence") {
    super(message);
    this.name = "GmailEvidenceError";
    this.code = code;
  }
}

function cleanText(value, max, { required = false } = {}) {
  const cleaned = String(value ?? "").replace(BAD_TEXT, "").trim();
  if (required && !cleaned) throw new GmailEvidenceError("required evidence text is missing");
  if (cleaned.length > max) throw new GmailEvidenceError("evidence text is too long");
  return cleaned || null;
}

function identifier(value, label, { required = false } = {}) {
  const result = cleanText(value, 512, { required });
  if (result && !IDENTIFIER.test(result)) throw new GmailEvidenceError(`invalid ${label}`);
  return result;
}

function emailAddress(value, label) {
  const raw = cleanText(value, 320, { required: true }).toLowerCase();
  const bracketed = raw.match(/<([^<>]+)>$/)?.[1] || raw;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(bracketed)) throw new GmailEvidenceError(`invalid ${label}`);
  return bracketed;
}

function mailboxIdentity(context) {
  exactFields(context, MAILBOX_FIELDS);
  const mailboxActor = cleanText(context.mailboxActor, 40, { required: true });
  if (!ACTORS.has(mailboxActor)) throw new GmailEvidenceError("mailboxActor must be Eben or Garrett");
  const grantOwner = emailAddress(context.grantOwner, "grantOwner");
  const expectedOwner = mailboxActor === "Eben" ? "eben@amarimethod.com" : "garrett@amarimethod.com";
  if (grantOwner !== expectedOwner) throw new GmailEvidenceError("mailboxActor and grantOwner do not match");
  return { mailboxActor, grantOwner };
}

function exactFields(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new GmailEvidenceError("evidence object is required");
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length) throw new GmailEvidenceError(`unsupported evidence fields: ${unknown.join(", ")}`, "unsupported_fields");
}

function timestamp(value, label) {
  const result = cleanText(value, 40, { required: true });
  if (!Number.isFinite(Date.parse(result))) throw new GmailEvidenceError(`invalid ${label}`);
  return new Date(result).toISOString();
}

function historyId(value, { required = false } = {}) {
  const result = cleanText(value, 64, { required });
  if (result && !/^\d+$/.test(result)) throw new GmailEvidenceError("invalid historyId");
  return result;
}

function headerValue(value, label) {
  if (value == null || value === "") return null;
  const unfolded = String(value).replace(/\r?\n[ \t]*/g, " ").replace(BAD_TEXT, "").trim();
  if (!unfolded || unfolded.length > 998) throw new GmailEvidenceError(`invalid ${label}`);
  return unfolded;
}

function stringArray(value, label, mapper = (entry) => cleanText(entry, 998, { required: true })) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new GmailEvidenceError(`invalid ${label}`);
  return value.map(mapper);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function scoped(owner, identifierValue) {
  return `${owner}:${identifierValue}`;
}

async function deterministicId(prefix, value) {
  return `${prefix}_${(await sha256(value)).slice(0, 32)}`;
}

async function historyStatement(db, identity, mailboxAddress, cursor, observedAt) {
  if (!cursor) return null;
  const id = await deterministicId("ghh", `${identity.grantOwner}\n${mailboxAddress}\n${cursor}`);
  return db.prepare(
    `INSERT OR IGNORE INTO gmail_history_observations
     (id, mailbox_actor, grant_owner, mailbox_address, history_id, observed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, identity.mailboxActor, identity.grantOwner, mailboxAddress, cursor, observedAt, observedAt);
}

async function reviewStatement(db, { identity, sourceKind, sourceId, reason, candidateContactIds, summary, now }) {
  const id = await deterministicId("ghr", `${identity.grantOwner}\n${sourceKind}\n${sourceId}`);
  return db.prepare(
    `INSERT OR IGNORE INTO gmail_evidence_reviews
     (id, mailbox_actor, grant_owner, source_kind, source_id, reason, candidate_contact_ids_json,
      evidence_summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, identity.mailboxActor, identity.grantOwner, sourceKind, sourceId, reason,
    JSON.stringify([...new Set(candidateContactIds)].sort()), JSON.stringify(summary), now);
}

async function recordHistory(db, identity, mailboxAddress, cursor, observedAt) {
  const statement = await historyStatement(db, identity, mailboxAddress, cursor, observedAt);
  if (statement) await statement.run();
}

function providerResult(row, deduped) {
  return {
    kind: "provider_outcome",
    outcome: row.outcome,
    contactId: row.contact_id || null,
    attribution: row.contact_id ? "exact" : "review",
    deduped,
  };
}

async function providerOutcome(db, identity, input, now) {
  exactFields(input, PROVIDER_FIELDS);
  const normalized = {
    providerEventId: identifier(input.providerEventId, "providerEventId", { required: true }),
    outcome: cleanText(input.outcome, 16, { required: true }).toLowerCase(),
    providerMessageId: identifier(input.providerMessageId, "providerMessageId"),
    gmailThreadId: identifier(input.gmailThreadId, "gmailThreadId"),
    rfcMessageId: headerValue(input.rfcMessageId, "rfcMessageId"),
    submissionRef: identifier(input.submissionRef, "submissionRef"),
    historyId: historyId(input.historyId),
    failureCode: cleanText(input.failureCode, 120),
    failureDetail: cleanText(input.failureDetail, 1000),
    occurredAt: timestamp(input.occurredAt, "occurredAt"),
  };
  if (!OUTCOMES.has(normalized.outcome)) throw new GmailEvidenceError("invalid provider outcome");
  const payloadHash = await sha256({ ...identity, ...normalized });
  const existing = await db.prepare(
    "SELECT outcome, contact_id, payload_sha256 FROM gmail_provider_events WHERE grant_owner = ? AND provider_event_id = ?",
  ).bind(identity.grantOwner, normalized.providerEventId).first();
  if (existing) {
    if (existing.payload_sha256 !== payloadHash) throw new GmailEvidenceError("provider event ID was reused for different evidence", "idempotency_conflict");
    return providerResult(existing, true);
  }

  const submission = normalized.submissionRef
    ? await db.prepare(
      `SELECT id, contact_id, provider_message_id, gmail_thread_id, rfc_message_id
         FROM gmail_provider_submissions WHERE grant_owner = ? AND submission_ref = ?`,
    ).bind(identity.grantOwner, normalized.submissionRef).first()
    : null;
  const submissionConflicts = Boolean(submission && (
    (normalized.providerMessageId && normalized.providerMessageId !== submission.provider_message_id) ||
    (normalized.gmailThreadId && submission.gmail_thread_id && normalized.gmailThreadId !== submission.gmail_thread_id) ||
    (normalized.rfcMessageId && submission.rfc_message_id && normalized.rfcMessageId !== submission.rfc_message_id)
  ));
  const exactSubmission = submissionConflicts ? null : submission;
  const id = await deterministicId("ghp", `${identity.grantOwner}\n${normalized.providerEventId}`);
  const statements = [db.prepare(
    `INSERT INTO gmail_provider_events
     (id, mailbox_actor, grant_owner, provider_event_id, outcome, provider_message_id, gmail_thread_id,
      rfc_message_id, submission_ref, submission_id, contact_id, history_id, failure_code, failure_detail_clean,
      payload_sha256, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, identity.mailboxActor, identity.grantOwner, normalized.providerEventId, normalized.outcome,
    normalized.providerMessageId, normalized.gmailThreadId, normalized.rfcMessageId, normalized.submissionRef,
    exactSubmission?.id || null, exactSubmission?.contact_id || null, normalized.historyId, normalized.failureCode,
    normalized.failureDetail, payloadHash, normalized.occurredAt, now)];
  if (!exactSubmission) {
    statements.push(await reviewStatement(db, {
      identity, sourceKind: "provider_outcome", sourceId: normalized.providerEventId,
      reason: submissionConflicts ? "conflicting_submission_evidence" : "unmatched_provider_submission_ref",
      candidateContactIds: submissionConflicts ? [submission.contact_id] : [],
      summary: { submissionRef: normalized.submissionRef, outcome: normalized.outcome }, now,
    }));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await db.prepare(
      "SELECT outcome, contact_id, payload_sha256 FROM gmail_provider_events WHERE grant_owner = ? AND provider_event_id = ?",
    ).bind(identity.grantOwner, normalized.providerEventId).first();
    if (!raced) throw error;
    if (raced.payload_sha256 !== payloadHash) throw new GmailEvidenceError("provider event ID was reused for different evidence", "idempotency_conflict");
    return providerResult(raced, true);
  }
  return { kind: "provider_outcome", outcome: normalized.outcome, contactId: exactSubmission?.contact_id || null, attribution: exactSubmission ? "exact" : "review", deduped: false };
}

async function queryContactIds(db, sql, values) {
  const rows = (await db.prepare(sql).bind(...values).all()).results || [];
  return [...new Set(rows.map((row) => row.contact_id).filter(Boolean))];
}

async function inboundAttribution(db, identity, evidence) {
  const replyHeaders = [...new Set([evidence.inReplyTo, ...evidence.references].filter(Boolean))];
  const rfcContacts = replyHeaders.length
    ? await queryContactIds(db,
      `SELECT contact_id FROM gmail_provider_submissions
        WHERE grant_owner = ? AND rfc_message_id IN (${replyHeaders.map(() => "?").join(", ")})
       UNION
       SELECT contact_id FROM gmail_provider_events
        WHERE grant_owner = ? AND contact_id IS NOT NULL
          AND rfc_message_id IN (${replyHeaders.map(() => "?").join(", ")})`,
      [identity.grantOwner, ...replyHeaders, identity.grantOwner, ...replyHeaders])
    : [];
  const threadContacts = await queryContactIds(db,
    `SELECT contact_id FROM gmail_provider_submissions
      WHERE grant_owner = ? AND gmail_thread_id = ?
     UNION
     SELECT contact_id FROM gmail_provider_events
      WHERE grant_owner = ? AND gmail_thread_id = ? AND contact_id IS NOT NULL
     UNION
     SELECT contact_id FROM gmail_inbound_messages
      WHERE grant_owner = ? AND gmail_thread_id = ? AND contact_id IS NOT NULL`,
    [identity.grantOwner, evidence.gmailThreadId, identity.grantOwner, evidence.gmailThreadId,
      identity.grantOwner, evidence.gmailThreadId]);

  const senderContacts = await queryContactIds(db,
    "SELECT id AS contact_id FROM contacts WHERE email_normalized = ?",
    [evidence.fromAddress]);
  if (rfcContacts.length > 1 || threadContacts.length > 1 || (rfcContacts[0] && threadContacts[0] && rfcContacts[0] !== threadContacts[0])) {
    return { contactId: null, basis: "review", reason: "conflicting_thread_evidence", candidates: [...rfcContacts, ...threadContacts, ...senderContacts] };
  }
  const strongContact = rfcContacts[0] || threadContacts[0] || null;
  if (strongContact && senderContacts.length === 1 && senderContacts[0] !== strongContact) {
    return { contactId: null, basis: "review", reason: "conflicting_thread_evidence", candidates: [strongContact, senderContacts[0]] };
  }
  if (rfcContacts.length === 1) return { contactId: rfcContacts[0], basis: "rfc_reply", candidates: rfcContacts };
  if (threadContacts.length === 1) return { contactId: threadContacts[0], basis: "gmail_thread", candidates: threadContacts };
  if (senderContacts.length === 1) return { contactId: senderContacts[0], basis: "unique_sender", candidates: senderContacts };
  return {
    contactId: null,
    basis: "review",
    reason: senderContacts.length > 1 ? "ambiguous_contact" : "no_exact_contact",
    candidates: senderContacts,
  };
}

function inboundResult(row, deduped) {
  return {
    kind: "inbound_message",
    contactId: row.contact_id || null,
    attribution: row.attribution_basis,
    deduped,
  };
}

async function inboundMessage(db, identity, input, now) {
  exactFields(input, INBOUND_FIELDS);
  const evidence = {
    providerMessageId: identifier(input.providerMessageId, "providerMessageId", { required: true }),
    gmailThreadId: identifier(input.gmailThreadId, "gmailThreadId", { required: true }),
    rfcMessageId: headerValue(input.rfcMessageId, "rfcMessageId"),
    inReplyTo: headerValue(input.inReplyTo, "inReplyTo"),
    references: stringArray(input.references, "references", (entry) => headerValue(entry, "reference")),
    mailboxAddress: emailAddress(input.mailboxAddress || identity.grantOwner, "mailboxAddress"),
    fromAddress: emailAddress(input.fromAddress, "fromAddress"),
    toAddresses: stringArray(input.toAddresses, "toAddresses", (entry) => emailAddress(entry, "toAddress")),
    subject: cleanText(input.subject, 500),
    body: cleanText(input.body, 50000),
    historyId: historyId(input.historyId, { required: true }),
    receivedAt: timestamp(input.receivedAt, "receivedAt"),
  };
  if (evidence.mailboxAddress !== identity.grantOwner) throw new GmailEvidenceError("mailboxAddress must equal grantOwner");
  const payloadHash = await sha256({ ...identity, ...evidence });
  const existing = await db.prepare(
    `SELECT contact_id, attribution_basis, payload_sha256
       FROM gmail_inbound_messages WHERE grant_owner = ? AND provider_message_id = ?`,
  ).bind(identity.grantOwner, evidence.providerMessageId).first();
  if (existing) {
    if (existing.payload_sha256 !== payloadHash) throw new GmailEvidenceError("provider message ID was reused for different evidence", "idempotency_conflict");
    return inboundResult(existing, true);
  }

  const attribution = await inboundAttribution(db, identity, evidence);
  const id = await deterministicId("ghi", `${identity.grantOwner}\n${evidence.providerMessageId}`);
  const threadId = await deterministicId("gct", `${identity.grantOwner}\n${evidence.gmailThreadId}`);
  const communicationId = await deterministicId("gce", `${identity.grantOwner}\n${evidence.providerMessageId}`);
  const statements = [db.prepare(
    `INSERT INTO gmail_inbound_messages
     (id, mailbox_actor, grant_owner, provider_message_id, gmail_thread_id, rfc_message_id, in_reply_to,
      references_json, mailbox_address, from_address, to_addresses_json, subject_clean, body_clean,
      history_id, contact_id, attribution_basis, payload_sha256, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, identity.mailboxActor, identity.grantOwner, evidence.providerMessageId, evidence.gmailThreadId,
    evidence.rfcMessageId, evidence.inReplyTo, JSON.stringify(evidence.references), evidence.mailboxAddress,
    evidence.fromAddress, JSON.stringify(evidence.toAddresses), evidence.subject, evidence.body, evidence.historyId,
    attribution.contactId, attribution.basis, payloadHash, evidence.receivedAt, now)];
  if (attribution.contactId) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO communication_threads
       (id, contact_id, provider, provider_thread_id, channel, last_event_at, last_preview, last_direction,
        unread_inbound_count, created_at, updated_at)
       VALUES (?, ?, 'gmail', ?, 'email', NULL, NULL, 'unknown', 0, ?, ?)`,
    ).bind(threadId, attribution.contactId, scoped(identity.grantOwner, evidence.gmailThreadId), now, now));
    statements.push(db.prepare(
      `INSERT INTO communication_events
       (id, thread_id, contact_id, provider, provider_event_id, event_kind, direction, delivery_status,
        subject, body_clean, occurred_at, sender_label, created_at, updated_at)
       VALUES (?, ?, ?, 'gmail', ?, 'email', 'inbound', 'received', ?, ?, ?, ?, ?, ?)`,
    ).bind(communicationId, threadId, attribution.contactId, scoped(identity.grantOwner, evidence.providerMessageId),
      evidence.subject, evidence.body, evidence.receivedAt, evidence.fromAddress, now, now));
  }
  if (!attribution.contactId) {
    statements.push(await reviewStatement(db, {
      identity, sourceKind: "inbound_message", sourceId: evidence.providerMessageId,
      reason: attribution.reason, candidateContactIds: attribution.candidates,
      summary: { fromAddress: evidence.fromAddress, gmailThreadId: evidence.gmailThreadId, inReplyTo: evidence.inReplyTo }, now,
    }));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await db.prepare(
      `SELECT contact_id, attribution_basis, payload_sha256
         FROM gmail_inbound_messages WHERE grant_owner = ? AND provider_message_id = ?`,
    ).bind(identity.grantOwner, evidence.providerMessageId).first();
    if (!raced) throw error;
    if (raced.payload_sha256 !== payloadHash) throw new GmailEvidenceError("provider message ID was reused for different evidence", "idempotency_conflict");
    return inboundResult(raced, true);
  }
  return { kind: "inbound_message", contactId: attribution.contactId, attribution: attribution.basis, deduped: false };
}

async function historyObservation(db, identity, input, now) {
  exactFields(input, HISTORY_FIELDS);
  const mailboxAddress = emailAddress(input.mailboxAddress || identity.grantOwner, "mailboxAddress");
  if (mailboxAddress !== identity.grantOwner) throw new GmailEvidenceError("mailboxAddress must equal grantOwner");
  const cursor = historyId(input.historyId, { required: true });
  const observedAt = timestamp(input.observedAt || now, "observedAt");
  const existing = await db.prepare(
    `SELECT id FROM gmail_history_observations
      WHERE grant_owner = ? AND mailbox_address = ? AND history_id = ?`,
  ).bind(identity.grantOwner, mailboxAddress, cursor).first();
  await recordHistory(db, identity, mailboxAddress, cursor, observedAt);
  return { kind: "history_observation", mailboxActor: identity.mailboxActor, grantOwner: identity.grantOwner, mailboxAddress, historyId: cursor, deduped: Boolean(existing) };
}

async function syncGap(db, identity, input, now) {
  exactFields(input, SYNC_GAP_FIELDS);
  const mailboxAddress = emailAddress(input.mailboxAddress || identity.grantOwner, "mailboxAddress");
  if (mailboxAddress !== identity.grantOwner) throw new GmailEvidenceError("mailboxAddress must equal grantOwner");
  const providerMessageId = identifier(input.providerMessageId, "providerMessageId", { required: true });
  const cursor = historyId(input.historyId, { required: true });
  const reason = cleanText(input.reason, 80, { required: true });
  if (SYNC_GAP_REASONS.get(input.kind) !== reason) throw new GmailEvidenceError("invalid Gmail sync gap reason");
  const observedAt = timestamp(input.observedAt || now, "observedAt");
  const existing = await db.prepare(
    `SELECT id FROM gmail_sync_gap_reviews
      WHERE grant_owner = ? AND provider_message_id = ? AND history_id = ?`,
  ).bind(identity.grantOwner, providerMessageId, cursor).first();
  const id = await deterministicId("ghg", `${identity.grantOwner}\n${providerMessageId}\n${cursor}`);
  await db.prepare(
    `INSERT OR IGNORE INTO gmail_sync_gap_reviews
     (id, mailbox_actor, grant_owner, mailbox_address, provider_message_id, history_id, reason, observed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, identity.mailboxActor, identity.grantOwner, mailboxAddress, providerMessageId, cursor,
    reason, observedAt, now).run();
  return {
    kind: input.kind, mailboxActor: identity.mailboxActor, grantOwner: identity.grantOwner,
    mailboxAddress, providerMessageId, historyId: cursor, reason, deduped: Boolean(existing),
  };
}

// `mailboxContext` is a trusted server-derived authorization context, not
// provider evidence and never a request-body field. Routes that eventually
// call this repository must derive it from the signed Staff identity and the
// verified actor-specific Gmail grant before parsing provider evidence.
export async function recordGmailEvidence(db, mailboxContext, input, now = new Date().toISOString()) {
  if (!db) throw new GmailEvidenceError("Gmail evidence storage is unavailable", "storage_unavailable");
  const identity = mailboxIdentity(mailboxContext);
  if (input?.kind === "provider_outcome") return providerOutcome(db, identity, input, now);
  if (input?.kind === "inbound_message") return inboundMessage(db, identity, input, now);
  if (input?.kind === "history_observation") return historyObservation(db, identity, input, now);
  if (SYNC_GAP_REASONS.has(input?.kind)) return syncGap(db, identity, input, now);
  throw new GmailEvidenceError("unsupported Gmail evidence kind");
}

function boundedLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 50)) : 25;
}

export async function gmailEvidenceReadModel(db, options = {}) {
  if (!db) throw new GmailEvidenceError("Gmail evidence storage is unavailable", "storage_unavailable");
  const limit = boundedLimit(options.limit);
  const identityClauses = [];
  const values = [];
  if (options.mailboxActor || options.grantOwner) {
    const identity = mailboxIdentity({ mailboxActor: options.mailboxActor, grantOwner: options.grantOwner });
    identityClauses.push("mailbox_actor = ?");
    identityClauses.push("grant_owner = ?");
    values.push(identity.mailboxActor, identity.grantOwner);
  }
  const where = identityClauses.length ? `WHERE ${identityClauses.join(" AND ")}` : "";
  const historyFilters = identityClauses
    .map((clause) => clause.replace("mailbox_actor", "observation.mailbox_actor").replace("grant_owner", "observation.grant_owner"));
  const historyWhere = historyFilters.length ? `WHERE ${historyFilters.join(" AND ")} AND` : "WHERE";
  const [provider, inbound, reviews, history, syncGaps] = await Promise.all([
    db.prepare(`SELECT mailbox_actor, grant_owner, provider_event_id, outcome, provider_message_id,
                       gmail_thread_id, rfc_message_id, contact_id, occurred_at
                  FROM gmail_provider_events ${where}
                 ORDER BY datetime(occurred_at) DESC, id DESC LIMIT ?`).bind(...values, limit).all(),
    db.prepare(`SELECT mailbox_actor, grant_owner, provider_message_id, gmail_thread_id, rfc_message_id,
                       in_reply_to, references_json, mailbox_address, from_address, subject_clean,
                       contact_id, attribution_basis, received_at
                  FROM gmail_inbound_messages ${where}
                 ORDER BY datetime(received_at) DESC, id DESC LIMIT ?`).bind(...values, limit).all(),
    db.prepare(`SELECT mailbox_actor, grant_owner, source_kind, source_id, reason,
                       candidate_contact_ids_json, evidence_summary_json, created_at
                  FROM gmail_evidence_reviews ${where}
                 ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`).bind(...values, limit).all(),
    db.prepare(`SELECT observation.mailbox_actor, observation.grant_owner, observation.mailbox_address,
                       observation.history_id, observation.observed_at
                  FROM gmail_history_observations observation
                  ${historyWhere} NOT EXISTS (
                     SELECT 1 FROM gmail_history_observations newer
                      WHERE newer.grant_owner = observation.grant_owner
                        AND newer.mailbox_address = observation.mailbox_address
                        AND (length(newer.history_id) > length(observation.history_id)
                          OR (length(newer.history_id) = length(observation.history_id)
                              AND newer.history_id > observation.history_id))
                   )
                 ORDER BY observation.grant_owner, observation.mailbox_address
                 LIMIT ?`).bind(...values, limit).all(),
    db.prepare(`SELECT mailbox_actor, grant_owner, mailbox_address, provider_message_id,
                       history_id, reason, observed_at
                  FROM gmail_sync_gap_reviews ${where}
                 ORDER BY datetime(observed_at) DESC, id DESC LIMIT ?`).bind(...values, limit).all(),
  ]);
  return {
    limit,
    providerEvents: provider.results || [],
    inboundMessages: (inbound.results || []).map((row) => ({ ...row, references: JSON.parse(row.references_json), references_json: undefined })),
    reviews: (reviews.results || []).map((row) => ({
      ...row,
      candidateContactIds: JSON.parse(row.candidate_contact_ids_json),
      evidenceSummary: JSON.parse(row.evidence_summary_json),
      candidate_contact_ids_json: undefined,
      evidence_summary_json: undefined,
    })),
    latestHistory: history.results || [],
    syncGaps: syncGaps.results || [],
  };
}
