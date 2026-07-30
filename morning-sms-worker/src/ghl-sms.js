// GHL conversation SMS send for Workers (same endpoint as staff-send-text /
// ghl-send.js, but uses the worker token helper instead of Pages context).

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const CONTACT_ID = /^[A-Za-z0-9]+$/;
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u202A-\u202E\u2066-\u2069]/;
const SMS_MAX = 720;

/**
 * Parse MORNING_SMS_CONTACT_IDS (comma/whitespace separated GHL contact ids).
 * @param {string} raw
 * @returns {string[]}
 */
export function parseContactIds(raw) {
  if (!raw || typeof raw !== "string") return [];
  const out = [];
  const seen = new Set();
  for (const part of raw.split(/[,\s]+/)) {
    const id = part.trim();
    // GHL contact ids are long alphanumeric tokens — reject short junk like "bad".
    if (id.length < 10 || !CONTACT_ID.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {object} env
 * @param {{ contactId: string, message: string }} params
 * @returns {Promise<{ success: boolean, messageId?: string|null, status?: number, error?: string }>}
 */
export async function sendGhlSms(env, params) {
  const contactId = String(params.contactId || "").trim();
  const message = String(params.message || "").trim();

  if (!CONTACT_ID.test(contactId)) return { success: false, error: "invalid contactId" };
  if (!message) return { success: false, error: "empty message" };
  if (message.length > SMS_MAX) return { success: false, error: `message exceeds ${SMS_MAX} chars` };
  if (BAD_CHARS.test(message)) return { success: false, error: "message has disallowed characters" };

  let token;
  try {
    token = await getAccessToken(env);
  } catch (err) {
    return { success: false, error: `token: ${err?.message || String(err)}` };
  }

  let res;
  try {
    res = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ type: "SMS", contactId, message }),
    });
  } catch (err) {
    return { success: false, error: `fetch failed: ${err?.message || String(err)}` };
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    return {
      success: false,
      status: res.status,
      error: `GHL rejected send (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    };
  }

  let messageId = null;
  try {
    const body = await res.json();
    messageId = body?.messageId || body?.id || body?.conversationId || null;
  } catch {
    messageId = null;
  }
  return { success: true, messageId, status: res.status };
}
