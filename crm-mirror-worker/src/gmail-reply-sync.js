// Dormant Gmail reply synchronization orchestrator.
//
// This module has no route, schedule, watch, Pub/Sub, credential, send, or GHL
// integration. Its injected provider is a read-only boundary; this use case
// translates already-authorized Gmail history into append-only local evidence.

import { recordGmailEvidence } from "./gmail-evidence.js";

const MAILBOXES = new Map([
  ["Eben", "eben@amarimethod.com"],
  ["Garrett", "garrett@amarimethod.com"],
]);
const MAX_MESSAGES_PER_HISTORY_RECORD = 500;
const MAX_BODY_CHARS = 50000;
const MAX_BODY_DECODE_BYTES = (MAX_BODY_CHARS * 4) + 4;
const BAD_METADATA_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const PROVIDER_IDENTIFIER = /^[A-Za-z0-9@._:+<>\/-]{1,512}$/;
const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function mailboxContext(provider) {
  const actor = String(provider?.mailboxContext?.mailboxActor || "").trim();
  const owner = String(provider?.mailboxContext?.grantOwner || "").trim().toLowerCase();
  if (MAILBOXES.get(actor) !== owner) throw new Error("Gmail provider mailbox identity is invalid");
  if (typeof provider.listHistoryPage !== "function" || typeof provider.getMessage !== "function") {
    throw new Error("Gmail read provider is unavailable");
  }
  return { actor, owner };
}

async function latestCursor(db, owner) {
  const row = await db.prepare(
    `SELECT history_id FROM gmail_history_observations
      WHERE grant_owner = ? AND mailbox_address = ?
      ORDER BY length(history_id) DESC, history_id DESC LIMIT 1`,
  ).bind(owner, owner).first();
  return row?.history_id || null;
}

function decimalCompare(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function headerMap(message) {
  const headers = new Map();
  for (const header of message?.payload?.headers || []) {
    const name = String(header?.name || "").trim().toLowerCase();
    if (name && !headers.has(name)) headers.set(name, String(header?.value || "").trim());
  }
  return headers;
}

function address(value) {
  const raw = String(value || "");
  const candidate = (raw.match(/<([^<>]+)>\s*$/)?.[1] || raw).trim().toLowerCase();
  return candidate.length <= 320 && EMAIL_ADDRESS.test(candidate) ? candidate : null;
}

function addressEntries(value) {
  const entries = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  let angleDepth = 0;
  for (const character of String(value || "")) {
    if (escaped) escaped = false;
    else if (character === "\\" && quoted) escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === "<") angleDepth += 1;
    else if (!quoted && character === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (character === "," && !quoted && angleDepth === 0) {
      if (current.trim()) entries.push(current);
      current = "";
    } else current += character;
  }
  if (current.trim()) entries.push(current);
  return entries;
}

function recipientMetadata(values) {
  const entries = values.flatMap(addressEntries);
  const valid = entries.map(address).filter(Boolean);
  const unique = [...new Set(valid)];
  return {
    addresses: unique.slice(0, 100),
    adjusted: valid.length !== entries.length || unique.length > 100,
  };
}

function decodeBody(payload) {
  if (!payload) return null;
  if (String(payload.mimeType || "").toLowerCase() === "text/plain" && payload.body?.data) {
    const encoded = String(payload.body.data).replace(/-/g, "+").replace(/_/g, "/");
    const encodedLimit = Math.floor((Math.ceil(MAX_BODY_DECODE_BYTES / 3) * 4) / 4) * 4;
    const bounded = encoded.slice(0, encodedLimit);
    const padded = bounded.padEnd(Math.ceil(bounded.length / 4) * 4, "=");
    const binary = atob(padded);
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    return {
      body: decoded.slice(0, MAX_BODY_CHARS),
      truncated: encoded.length > bounded.length || decoded.length > MAX_BODY_CHARS,
    };
  }
  for (const part of payload.parts || []) {
    const body = decodeBody(part);
    if (body != null) return body;
  }
  return null;
}

function normalizedReferences(value) {
  const matches = String(value || "").match(/<[^<>]+>/g) || [];
  const bounded = matches.filter((reference) => reference.length <= 998);
  return {
    values: bounded.slice(0, 100),
    adjusted: bounded.length !== matches.length || bounded.length > 100,
  };
}

function boundedHeader(value) {
  if (value == null || value === "") return { value: null, adjusted: false };
  const unfolded = String(value).replace(/\r?\n[ \t]*/g, " ").trim();
  const clean = unfolded.replace(BAD_METADATA_TEXT, "");
  if (!clean) return { value: null, adjusted: true };
  if (clean.length > 998) return { value: null, adjusted: true };
  return { value: clean, adjusted: clean !== unfolded };
}

function boundedSubject(value) {
  if (value == null || value === "") return { value: null, adjusted: false };
  const clean = String(value).replace(BAD_METADATA_TEXT, "").trim();
  return {
    value: clean ? clean.slice(0, 500) : null,
    adjusted: clean.length > 500 || clean !== String(value).trim(),
  };
}

function snippetBody(value) {
  const clean = String(value || "")
    .replace(BAD_METADATA_TEXT, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 4000) : null;
}

function receivedAt(message, headers) {
  const internal = Number(message?.internalDate);
  if (Number.isFinite(internal) && internal > 0) return new Date(internal).toISOString();
  const date = Date.parse(headers.get("date") || "");
  if (Number.isFinite(date)) return new Date(date).toISOString();
  throw Object.assign(new Error("Gmail message is missing a trustworthy received time"), { code: "missing_received_at" });
}

function normalizeMessage(message, historyId, owner) {
  const providerMessageId = String(message?.id || "").trim();
  const gmailThreadId = String(message?.threadId || "").trim();
  if (!PROVIDER_IDENTIFIER.test(providerMessageId) || !PROVIDER_IDENTIFIER.test(gmailThreadId)) {
    throw Object.assign(new Error("Gmail message is missing usable message or thread metadata"), { code: "metadata_unusable" });
  }
  const headers = headerMap(message);
  const fromAddress = address(headers.get("from"));
  if (!fromAddress) throw Object.assign(new Error("Gmail message is missing a usable sender"), { code: "metadata_unusable" });
  const recipients = recipientMetadata([headers.get("to"), headers.get("cc")]);
  const refs = normalizedReferences(headers.get("references"));
  const rfcMessageId = boundedHeader(headers.get("message-id"));
  const inReplyTo = boundedHeader(headers.get("in-reply-to"));
  const subject = boundedSubject(headers.get("subject"));
  const decoded = decodeBody(message.payload);
  return {
    evidence: {
      kind: "inbound_message",
      providerMessageId,
      gmailThreadId,
      rfcMessageId: rfcMessageId.value,
      inReplyTo: inReplyTo.value,
      references: refs.values,
      mailboxAddress: owner,
      fromAddress,
      toAddresses: recipients.addresses,
      subject: subject.value,
      body: decoded?.body ?? snippetBody(message.snippet),
      historyId,
      receivedAt: receivedAt(message, headers),
    },
    bodyTruncated: Boolean(decoded?.truncated),
    metadataTruncated: recipients.adjusted || refs.adjusted || rfcMessageId.adjusted
      || inReplyTo.adjusted || subject.adjusted,
  };
}

function initialCounts() {
  return { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 };
}

function recovery(actor, owner, cursor, counts, error, detail = {}) {
  return {
    status: "recovery_required", actor, owner, cursor, counts,
    error: {
      code: String(error?.code || "gmail_history_failed"),
      message: String(error?.message || "Gmail history read failed"),
      ...detail,
    },
  };
}

function positiveLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function historyRecords(provider, startCursor, limit, counts) {
  const records = new Map();
  const pageTokens = new Set();
  let pageToken = null;
  let hasMore = false;
  let terminalHistoryId = null;
  do {
    const page = await provider.listHistoryPage({
      startHistoryId: startCursor,
      pageToken,
      maxResults: Math.min(limit, 500),
    });
    if (page?.historyId != null) {
      terminalHistoryId = String(page.historyId).trim();
      if (!/^\d+$/.test(terminalHistoryId)) {
        throw Object.assign(new Error("Gmail history response has an invalid high-water ID"), { code: "invalid_history_high_water" });
      }
    }
    for (const record of page?.history || []) {
      const id = String(record?.id || "").trim();
      if (!/^\d+$/.test(id)) throw Object.assign(new Error("Gmail history record is missing a decimal ID"), { code: "invalid_history_record" });
      if (decimalCompare(id, startCursor) <= 0) continue;
      const current = records.get(id) || { id, messageIds: [] };
      const local = new Set(current.messageIds);
      for (const added of record.messagesAdded || []) {
        const messageId = String(added?.message?.id || "").trim();
        if (!messageId) throw Object.assign(new Error("Gmail history message is missing an ID"), { code: "invalid_history_record" });
        if (local.has(messageId)) counts.deduped += 1;
        else {
          local.add(messageId);
          current.messageIds.push(messageId);
        }
      }
      records.set(id, current);
    }
    pageToken = String(page?.nextPageToken || "").trim() || null;
    hasMore = Boolean(pageToken);
    if (records.size > limit) break;
    if (pageToken) {
      if (pageTokens.has(pageToken)) throw Object.assign(new Error("Gmail history pagination repeated a page token"), { code: "invalid_history_pagination" });
      pageTokens.add(pageToken);
    }
  } while (pageToken);
  return {
    records: [...records.values()].sort((a, b) => decimalCompare(a.id, b.id)),
    hasMore,
    terminalHistoryId,
  };
}

export async function syncGmailReplies({ db, provider, maxHistoryRecords = 50, maxMessages = 50, now = new Date().toISOString() }) {
  if (!db) throw new Error("Gmail reply storage is unavailable");
  const { actor, owner } = mailboxContext(provider);
  const startCursor = await latestCursor(db, owner);
  const counts = initialCounts();
  if (!startCursor) return { status: "baseline_required", actor, owner, cursor: null, counts };
  const historyLimit = positiveLimit(maxHistoryRecords, 50);
  const messageLimit = positiveLimit(maxMessages, 50);
  let loaded;
  try {
    loaded = await historyRecords(provider, startCursor, historyLimit, counts);
  } catch (error) {
    return recovery(actor, owner, startCursor, counts, error);
  }
  const records = loaded.records;
  const seen = new Set();
  let cursor = startCursor;
  let partial = false;
  for (const record of records) {
    if (counts.historyRecords >= historyLimit) {
      partial = true;
      break;
    }
    if (record.messageIds.length > MAX_MESSAGES_PER_HISTORY_RECORD) {
      return recovery(actor, owner, cursor, counts, {
        code: "history_record_too_large",
        message: `Gmail history record exceeds the ${MAX_MESSAGES_PER_HISTORY_RECORD}-message safety limit`,
      }, { historyId: record.id });
    }
    const messageIds = record.messageIds.filter((id) => {
      if (seen.has(id)) {
        counts.deduped += 1;
        return false;
      }
      seen.add(id);
      return true;
    });
    if (counts.messages > 0 && counts.messages + messageIds.length > messageLimit) {
      partial = true;
      break;
    }
    for (const id of messageIds) {
      try {
        const message = await provider.getMessage(id);
        const labels = new Set((message?.labelIds || []).map((label) => String(label).toUpperCase()));
        const from = address(headerMap(message).get("from"));
        counts.messages += 1;
        if (labels.has("DRAFT") || labels.has("SENT") || from === owner) {
          counts.ignored += 1;
          continue;
        }
        const normalized = normalizeMessage(message, record.id, owner);
        const result = await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, normalized.evidence, now);
        if (result.deduped) counts.deduped += 1;
        if (result.attribution === "review") counts.reviewed += 1;
        else counts.accepted += 1;
        if (normalized.bodyTruncated) {
          const review = await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, {
            kind: "gmail_body_truncated",
            mailboxAddress: owner,
            providerMessageId: id,
            historyId: record.id,
            reason: "body_truncated",
            observedAt: now,
          }, now);
          counts.reviewed += 1;
          if (review.deduped) counts.deduped += 1;
        }
        if (normalized.metadataTruncated) {
          const review = await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, {
            kind: "gmail_metadata_truncated",
            mailboxAddress: owner,
            providerMessageId: id,
            historyId: record.id,
            reason: "metadata_truncated",
            observedAt: now,
          }, now);
          counts.reviewed += 1;
          if (review.deduped) counts.deduped += 1;
        }
      } catch (error) {
        if (error?.code === "metadata_unusable" || error?.code === "missing_received_at") {
          let result;
          try {
            result = await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, {
              kind: "gmail_metadata_unusable",
              mailboxAddress: owner,
              providerMessageId: id,
              historyId: record.id,
              reason: "metadata_unusable",
              observedAt: now,
            }, now);
          } catch (reviewError) {
            return recovery(actor, owner, cursor, counts, reviewError, { messageId: id, historyId: record.id });
          }
          counts.reviewed += 1;
          counts.skipped += 1;
          if (result.deduped) counts.deduped += 1;
          continue;
        }
        if (error?.code === "gmail_message_missing") {
          let result;
          try {
            result = await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, {
              kind: "gmail_message_missing",
              mailboxAddress: owner,
              providerMessageId: id,
              historyId: record.id,
              reason: "provider_message_missing",
              observedAt: now,
            }, now);
          } catch (reviewError) {
            return recovery(actor, owner, cursor, counts, reviewError, { messageId: id, historyId: record.id });
          }
          counts.messages += 1;
          counts.reviewed += 1;
          counts.skipped += 1;
          if (result.deduped) counts.deduped += 1;
          continue;
        }
        return recovery(actor, owner, cursor, counts, error, { messageId: id, historyId: record.id });
      }
    }
    await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, {
      kind: "history_observation", mailboxAddress: owner, historyId: record.id, observedAt: now,
    }, now);
    counts.historyRecords += 1;
    cursor = record.id;
  }
  if (counts.historyRecords < records.length || loaded.hasMore) partial = true;
  if (!partial && loaded.terminalHistoryId && decimalCompare(loaded.terminalHistoryId, cursor) > 0) {
    try {
      await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, {
        kind: "history_observation",
        mailboxAddress: owner,
        historyId: loaded.terminalHistoryId,
        observedAt: now,
      }, now);
      cursor = loaded.terminalHistoryId;
    } catch (error) {
      return recovery(actor, owner, cursor, counts, error, { historyId: loaded.terminalHistoryId });
    }
  }
  return { status: partial ? "partial" : "succeeded", actor, owner, cursor, counts };
}
