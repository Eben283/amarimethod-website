// Provider-neutral sender boundary. It is deliberately shadow-only: no
// credentials are read here and this module contains no provider network call.
export const OWNED_DELIVERY_MODE = "shadow";

export const DELIVERY_PROVIDERS = Object.freeze({
  email: Object.freeze({ id: "google-workspace", label: "Google Workspace", configured: false }),
  sms: Object.freeze({ id: "twilio", label: "Twilio", configured: false }),
});

function latestConsent(consents, channel) {
  return (consents || []).find((consent) => consent.channel === channel)?.state || "unknown";
}

function normalizedDnd(value) {
  return ["true", "1", "yes", "on", "dnd"].includes(String(value || "").trim().toLowerCase());
}

export function deliveryReadiness() {
  return {
    mode: OWNED_DELIVERY_MODE,
    deliveryEnabled: false,
    channels: Object.entries(DELIVERY_PROVIDERS).map(([channel, provider]) => ({
      channel,
      provider: provider.id,
      label: provider.label,
      configured: provider.configured,
      deliveryEnabled: false,
    })),
    safeguards: ["staff session", "explicit consent", "DND check", "immutable audit", "separate activation approval"],
  };
}

export function evaluateDeliveryEligibility({ contact, consents, channel, dnd }) {
  if (!Object.hasOwn(DELIVERY_PROVIDERS, channel)) throw new Error("unsupported delivery channel");
  const destination = channel === "email" ? contact?.email_normalized : contact?.phone_e164;
  const consentState = latestConsent(consents, channel);
  const reasons = [];
  if (!destination) reasons.push("missing_destination");
  if (consentState !== "granted") reasons.push("explicit_consent_required");
  if (normalizedDnd(dnd)) reasons.push("do_not_disturb");
  return {
    channel,
    provider: DELIVERY_PROVIDERS[channel].id,
    consentState,
    policyEligible: reasons.length === 0,
    deliveryAllowed: false,
    reasons: [...reasons, "sender_shadow_mode"],
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// This is an append-only audit writer for a future separately-approved sender
// path. The current Worker deliberately exposes no route that calls it.
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
    ).bind(attemptId, contactId, safeActor, channel, eligibility.provider, eligibility.consentState, eligibility.policyEligible ? "eligible" : "blocked", contentHash, now),
    db.prepare(
      `INSERT INTO outbound_delivery_events (id, attempt_id, event_type, detail_json, occurred_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(eventId, attemptId, "shadow_evaluated", JSON.stringify({ reasons: eligibility.reasons, deliveryAllowed: false }), now),
  ]);
  return { attemptId, ...eligibility };
}
