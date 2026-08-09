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
  return String(value || "").match(/<([^<>]+)>/)?.[1]?.trim().toLowerCase()
    || String(value || "").trim().toLowerCase();
}

function addresses(value) {
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
  return entries.map(address).filter(Boolean);
}

function decodeBody(payload) {
  if (!payload) return null;
  if (String(payload.mimeType || "").toLowerCase() === "text/plain" && payload.body?.data) {
    const encoded = String(payload.body.data).replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  }
  for (const part of payload.parts || []) {
    const body = decodeBody(part);
    if (body != null) return body;
  }
  return null;
}

function references(value) {
  return String(value || "").match(/<[^<>]+>/g) || [];
}

function snippetBody(value) {
  const clean = String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "")
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
  if (!providerMessageId || !gmailThreadId) {
    throw Object.assign(new Error("Gmail message is missing its message or thread ID"), { code: "invalid_gmail_message" });
  }
  const headers = headerMap(message);
  const toAddresses = [...new Set([
    ...addresses(headers.get("to")),
    ...addresses(headers.get("cc")),
  ])];
  return {
    kind: "inbound_message",
    providerMessageId,
    gmailThreadId,
    rfcMessageId: headers.get("message-id") || null,
    inReplyTo: headers.get("in-reply-to") || null,
    references: references(headers.get("references")),
    mailboxAddress: owner,
    fromAddress: headers.get("from"),
    toAddresses,
    subject: headers.get("subject") || null,
    body: decodeBody(message.payload) ?? snippetBody(message.snippet),
    historyId,
    receivedAt: receivedAt(message, headers),
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
  do {
    const page = await provider.listHistoryPage({
      startHistoryId: startCursor,
      pageToken,
      maxResults: Math.min(limit, 500),
    });
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
  return { records: [...records.values()].sort((a, b) => decimalCompare(a.id, b.id)), hasMore };
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
        const result = await recordGmailEvidence(db, { mailboxActor: actor, grantOwner: owner }, normalizeMessage(message, record.id, owner), now);
        if (result.deduped) counts.deduped += 1;
        if (result.attribution === "review") counts.reviewed += 1;
        else counts.accepted += 1;
      } catch (error) {
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
  return { status: partial ? "partial" : "succeeded", actor, owner, cursor, counts };
}
