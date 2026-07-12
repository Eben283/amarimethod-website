// Shared GHL "send a conversation message" adapter — reminder/nurture/purchase engines
// (twin-migration substrate). ONE place that turns {channel, contactId, copy} into a GHL
// message send, so every code-owned flow sends identically. Pure input validation + a single
// POST; idempotency is the CALLER's job (the timer/ledger keys each send by enrollment+step),
// so this adapter never double-guards and never throws on a GHL rejection — it returns a typed
// result the caller can log/retry.
//
// Modeled on the existing staff-send-email.js / staff-send-text.js send logic (same endpoint,
// same length + bad-char guards) so those endpoints can later be pointed at this without any
// behavior drift. Not rewired here — that touches live endpoints and belongs to its own pass.

import { ghlFetch } from "./ghl.js";

export const GHL_MESSAGE_ENDPOINT = "https://services.leadconnectorhq.com/conversations/messages";

export const SEND_LIMITS = Object.freeze({
  SMS_MAX: 720,
  EMAIL_SUBJECT_MAX: 200,
  EMAIL_BODY_MAX: 8000,
});

// Control chars (allowing \t \n \r) + Unicode bidi overrides — the same denylist the staff
// send endpoints use to stop payload smuggling in merge-field content.
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u202A-\u202E\u2066-\u2069]/;
const CONTACT_ID = /^[A-Za-z0-9]+$/;

/**
 * Validate send params without performing I/O.
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateSend(params) {
  if (params == null || typeof params !== "object") return { ok: false, error: "missing params" };
  const { channel, contactId, subject, html, message } = params;

  if (channel !== "sms" && channel !== "email") return { ok: false, error: "channel must be 'sms' or 'email'" };
  if (typeof contactId !== "string" || !CONTACT_ID.test(contactId)) return { ok: false, error: "invalid contactId" };

  if (channel === "sms") {
    if (typeof message !== "string" || message.trim() === "") return { ok: false, error: "sms message is required" };
    if (message.length > SEND_LIMITS.SMS_MAX) return { ok: false, error: `sms message exceeds ${SEND_LIMITS.SMS_MAX} chars` };
    if (BAD_CHARS.test(message)) return { ok: false, error: "sms message contains disallowed characters" };
    return { ok: true };
  }

  // email
  if (typeof subject !== "string" || subject.trim() === "") return { ok: false, error: "email subject is required" };
  if (typeof html !== "string" || html.trim() === "") return { ok: false, error: "email body is required" };
  if (subject.length > SEND_LIMITS.EMAIL_SUBJECT_MAX) return { ok: false, error: `email subject exceeds ${SEND_LIMITS.EMAIL_SUBJECT_MAX} chars` };
  if (html.length > SEND_LIMITS.EMAIL_BODY_MAX) return { ok: false, error: `email body exceeds ${SEND_LIMITS.EMAIL_BODY_MAX} chars` };
  if (BAD_CHARS.test(subject) || BAD_CHARS.test(html)) return { ok: false, error: "email contains disallowed characters" };
  return { ok: true };
}

function buildPayload(params) {
  if (params.channel === "sms") {
    return { type: "SMS", contactId: params.contactId, message: params.message };
  }
  return { type: "Email", contactId: params.contactId, subject: params.subject, html: params.html };
}

/**
 * Send a GHL conversation message (SMS or Email) to a contact. Never throws; returns a typed
 * result. Idempotency is the caller's responsibility.
 *
 * @param {object} context - Pages Function / worker context carrying env + GHL auth.
 * @param {{channel:'sms'|'email', contactId:string, message?:string, subject?:string, html?:string}} params
 * @returns {Promise<{success:boolean, channel?:string, contactId?:string, messageId?:string|null, status?:number, error?:string}>}
 */
export async function sendConversationMessage(context, params) {
  const valid = validateSend(params);
  if (!valid.ok) return { success: false, error: valid.error };

  const payload = buildPayload(params);
  let res;
  try {
    res = await ghlFetch(context, GHL_MESSAGE_ENDPOINT, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { success: false, channel: params.channel, contactId: params.contactId, error: `send failed: ${err?.message || String(err)}` };
  }

  if (!res || !res.ok) {
    const status = res?.status;
    let detail = "";
    try {
      detail = res && typeof res.text === "function" ? await res.text() : "";
    } catch {
      detail = "";
    }
    return { success: false, channel: params.channel, contactId: params.contactId, status, error: `GHL rejected send${status ? ` (${status})` : ""}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
  }

  let messageId = null;
  try {
    const body = typeof res.json === "function" ? await res.json() : null;
    messageId = body?.messageId || body?.id || body?.conversationId || null;
  } catch {
    messageId = null;
  }
  return { success: true, channel: params.channel, contactId: params.contactId, messageId };
}
