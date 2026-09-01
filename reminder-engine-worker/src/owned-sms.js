const E164 = /^\+[1-9][0-9]{7,14}$/;
const clean = (value) => String(value || "").trim();

export function ownedSmsConfigured(env) {
  return Boolean(env?.OWNED_SMS?.fetch && clean(env?.WORKER_AUTH_SECRET));
}

export function validOwnedSmsRecipient(value) {
  return E164.test(clean(value));
}

/**
 * Provider-neutral SMS command edge. Lifecycle code supplies only the E.164
 * destination, rendered text, and its durable idempotency identity; no GHL
 * contact or conversation identifier can cross this boundary.
 */
export async function sendOwnedSms(env, message) {
  const to = clean(message?.to);
  const text = clean(message?.text);
  const idempotencyKey = clean(message?.idempotencyKey);
  if (!ownedSmsConfigured(env)) return { success: false, error: "owned SMS provider is unavailable" };
  if (!validOwnedSmsRecipient(to) || !text || !idempotencyKey) {
    return { success: false, error: "owned SMS command is incomplete" };
  }
  const response = await env.OWNED_SMS.fetch("https://owned-sms/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WORKER_AUTH_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, text, idempotencyKey }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success !== true || !clean(body?.messageId)) {
    return { success: false, error: `owned SMS provider rejected the command (${response.status})` };
  }
  return { success: true, messageId: clean(body.messageId) };
}
