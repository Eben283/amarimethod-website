// Actor-bound Gmail read adapter for a future reply-sync engine.
//
// This module can list message-added history and read one full message. It has
// no route, watch registration, dispatch, Gmail send request, GHL fallback, or
// storage side effect beyond the existing OAuth helper's token refresh.

import {
  forceRefreshGoogleWorkspaceToken,
  getGoogleWorkspaceToken,
  resolveAmariMailIdentity,
} from "./gmail.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const OPTION_FIELDS = new Set(["fetchImpl"]);
const HISTORY_FIELDS = new Set(["startHistoryId", "pageToken", "maxResults"]);
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,256}$/;
const DECIMAL_ID = /^\d{1,20}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const INT64_MAX = 9_223_372_036_854_775_807n;
const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000n;
const RETRYABLE_403_REASONS = new Set([
  "dailyLimitExceeded",
  "quotaExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

export class GmailReplyProviderError extends Error {
  constructor(message, code, status, retryable) {
    super(message);
    this.name = "GmailReplyProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function invalid(message) {
  return new GmailReplyProviderError(message, "invalid_input", 400, false);
}

function exactFields(input, allowed, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid(`${label} is required`);
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length) throw invalid(`unsupported ${label} fields: ${unknown.join(", ")}`);
}

function decimalId(value, label) {
  if (typeof value !== "string" || !DECIMAL_ID.test(value) || BigInt(value) > INT64_MAX) {
    throw invalid(`${label} must be an int64 decimal string`);
  }
  return value;
}

function providerId(value, label) {
  if (typeof value !== "string" || !PROVIDER_ID.test(value)) throw invalid(`invalid ${label}`);
  return value;
}

function pageToken(value) {
  if (value == null || value === "") return null;
  const result = String(value);
  if (result.length > 2048 || CONTROL.test(result)) throw invalid("invalid pageToken");
  return result;
}

function maximum(value) {
  if (value == null) return 50;
  if (!Number.isInteger(value) || value < 1) throw invalid("maxResults must be a positive integer");
  return Math.min(value, 500);
}

function malformed(message) {
  return new GmailReplyProviderError(message, "malformed_provider_payload", 502, false);
}

function objectPayload(payload, label) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw malformed(`Gmail returned malformed ${label}`);
  return payload;
}

function providerDecimalId(value, label) {
  if (typeof value !== "string" || !DECIMAL_ID.test(value) || BigInt(value) > INT64_MAX) {
    throw malformed(`Gmail ${label} is invalid`);
  }
  return value;
}

function internalDate(value) {
  if (typeof value !== "string" || !DECIMAL_ID.test(value) || BigInt(value) > MAX_DATE_EPOCH_MS) {
    throw malformed("Gmail internalDate is invalid");
  }
  return value;
}

function historyPayload(raw) {
  const payload = objectPayload(raw, "history");
  const currentHistoryId = providerDecimalId(payload.historyId, "historyId");
  if (payload.nextPageToken != null && (typeof payload.nextPageToken !== "string" || !payload.nextPageToken)) {
    throw malformed("Gmail nextPageToken is invalid");
  }
  const history = payload.history == null ? [] : payload.history;
  if (!Array.isArray(history)) throw malformed("Gmail history is invalid");
  const canonicalHistory = history.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw malformed("Gmail history record is invalid");
    }
    const id = providerDecimalId(record.id, "history record id");
    const addedMessages = record.messagesAdded == null ? [] : record.messagesAdded;
    if (!Array.isArray(addedMessages)) throw malformed("Gmail messagesAdded is invalid");
    const messagesAdded = addedMessages.map((added) => {
      const message = added?.message;
      if (!message || typeof message.id !== "string" || !PROVIDER_ID.test(message.id)
        || typeof message.threadId !== "string" || !PROVIDER_ID.test(message.threadId)) {
        throw malformed("Gmail message-added reference is invalid");
      }
      return { message: { id: message.id, threadId: message.threadId } };
    });
    return { id, messagesAdded };
  });
  return { history: canonicalHistory, nextPageToken: payload.nextPageToken || null, historyId: currentHistoryId };
}

function messagePayload(raw, requestedId) {
  const payload = objectPayload(raw, "message");
  if (payload.id !== requestedId
    || typeof payload.threadId !== "string" || !PROVIDER_ID.test(payload.threadId)
    || !payload.payload || typeof payload.payload !== "object" || Array.isArray(payload.payload)
    || (payload.labelIds != null && !Array.isArray(payload.labelIds))) {
    throw malformed("Gmail message payload is invalid");
  }
  providerDecimalId(payload.historyId, "historyId");
  internalDate(payload.internalDate);
  return payload;
}

function providerReasons(payload) {
  const reasons = payload?.error?.errors;
  return Array.isArray(reasons)
    ? reasons.map((entry) => entry?.reason).filter((reason) => typeof reason === "string")
    : [];
}

function responseError(status, context, payload) {
  if (context.kind === "history" && status === 404) {
    return new GmailReplyProviderError("Gmail history cursor expired", "history_cursor_expired", 404, false);
  }
  if (context.kind === "message" && status === 404) {
    return new GmailReplyProviderError("Gmail message is no longer available", "gmail_message_missing", 404, false);
  }
  if (status === 403 && (payload?.error?.status === "RESOURCE_EXHAUSTED"
    || providerReasons(payload).some((reason) => RETRYABLE_403_REASONS.has(reason)))) {
    return new GmailReplyProviderError("Gmail provider quota is temporarily unavailable", "gmail_provider_failed", 403, true);
  }
  if (status === 401 || status === 403) {
    return new GmailReplyProviderError("Gmail authorization failed", "gmail_auth_failed", status, false);
  }
  return new GmailReplyProviderError("Gmail provider request failed", "gmail_provider_failed", status, status === 429 || status >= 500);
}

function tokenError(error) {
  const status = Number(error?.status);
  const retryable = error?.retryable === true || status === 429 || status >= 500;
  if (retryable) {
    return new GmailReplyProviderError("Amari Gmail token provider is unavailable", "gmail_provider_failed",
      Number.isInteger(status) && status > 0 ? status : 503, true);
  }
  return new GmailReplyProviderError("Amari Gmail grant is unavailable", "gmail_auth_failed", 401, false);
}

export function createGmailReplyProvider(env, signedActor, options = {}) {
  exactFields(options, OPTION_FIELDS, "provider option");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw invalid("fetchImpl is required");
  let identity;
  try {
    identity = resolveAmariMailIdentity(signedActor);
  } catch {
    throw invalid("signed actor does not have an Amari mailbox");
  }
  const mailboxContext = Object.freeze({ mailboxActor: identity.actor, grantOwner: identity.from });

  async function accessToken() {
    try {
      return await getGoogleWorkspaceToken(env, identity.actor);
    } catch (error) {
      throw tokenError(error);
    }
  }

  async function refreshedToken() {
    try {
      return await forceRefreshGoogleWorkspaceToken(env, identity.actor);
    } catch (error) {
      throw tokenError(error);
    }
  }

  async function request(url, token) {
    let response;
    try {
      response = await fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new GmailReplyProviderError("Gmail provider request failed", "gmail_provider_failed", 503, true);
    }
    return response;
  }

  async function errorPayload(response) {
    try { return await response.json(); } catch { return null; }
  }

  async function get(url, context) {
    let response = await request(url, await accessToken());
    if (response?.status === 401) response = await request(url, await refreshedToken());
    if (!response?.ok) {
      const status = Number(response?.status || 503);
      throw responseError(status, context, await errorPayload(response));
    }
    try {
      return await response.json();
    } catch {
      throw malformed("Gmail returned invalid JSON");
    }
  }

  async function listHistoryPage(input) {
    exactFields(input, HISTORY_FIELDS, "history request");
    const query = new URLSearchParams({
      startHistoryId: decimalId(input.startHistoryId, "startHistoryId"),
      historyTypes: "messageAdded",
      maxResults: String(maximum(input.maxResults)),
    });
    const token = pageToken(input.pageToken);
    if (token) query.set("pageToken", token);
    return historyPayload(await get(`${GMAIL_API}/history?${query}`, { kind: "history" }));
  }

  async function getMessage(messageId) {
    const id = providerId(messageId, "messageId");
    return messagePayload(await get(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`, { kind: "message" }), id);
  }

  return Object.freeze({ mailboxContext, listHistoryPage, getMessage });
}
