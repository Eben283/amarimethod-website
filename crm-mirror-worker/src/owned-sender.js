// Provider-neutral sender boundary. Individual staff-initiated email is live;
// SMS remains inactive until its provider is separately implemented.
//
// Amari policy (approved 2026-08-04): a contact is eligible for an individual
// staff communication unless that channel has an explicit opt-out / DND block.
// An absent historical opt-in is not itself a block. This does not override
// provider suppressions, legal requirements, or the shadow-mode delivery gate.
export const OWNED_DELIVERY_MODE = "staff_email";

export const DELIVERY_PROVIDERS = Object.freeze({
  email: Object.freeze({ id: "google-workspace", label: "Google Workspace", configured: false }),
  sms: Object.freeze({ id: "twilio", label: "Twilio", configured: false }),
});

function latestConsent(consents, channel) {
  return (consents || []).find((consent) => consent.channel === channel && consent.state !== "unknown")?.state || "unknown";
}

function normalizedDnd(value) {
  return ["true", "1", "yes", "on", "dnd"].includes(String(value || "").trim().toLowerCase());
}

export function deliveryReadiness(env = {}) {
  const emailConfigured = Boolean(env.PORTAL_KV && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
  return {
    mode: OWNED_DELIVERY_MODE,
    deliveryEnabled: emailConfigured,
    channels: Object.entries(DELIVERY_PROVIDERS).map(([channel, provider]) => ({
      channel,
      provider: provider.id,
      label: provider.label,
      configured: channel === "email" ? emailConfigured : provider.configured,
      deliveryEnabled: channel === "email" && emailConfigured,
    })),
    safeguards: ["signed staff session", "same-origin compose request", "channel opt-out and DND check", "immutable audit", "Gmail authorization"],
  };
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
    provider: DELIVERY_PROVIDERS[channel].id,
    consentState,
    policyEligible: reasons.length === 0,
    deliveryAllowed: reasons.length === 0,
    reasons,
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

export async function recordDeliveredAttempt(db, { contactId, actor, channel, contact, consents, dnd, content }, now) {
  const safeActor = String(actor || "").trim();
  if (!contactId || !safeActor) throw new Error("contactId and actor are required");
  const eligibility = evaluateDeliveryEligibility({ contact, consents, channel, dnd });
  if (!eligibility.policyEligible) throw new Error("delivery blocked by policy");
  const attemptId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const contentHash = await sha256(content);
  await db.batch([
    db.prepare(`INSERT INTO outbound_delivery_attempts (id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, 'eligible', ?, ?)`).bind(attemptId, contactId, safeActor, channel, eligibility.provider, eligibility.consentState, contentHash, now),
    db.prepare(`INSERT INTO outbound_delivery_events (id, attempt_id, event_type, detail_json, occurred_at) VALUES (?, ?, 'provider_accepted', ?, ?)`).bind(eventId, attemptId, JSON.stringify({ provider: eligibility.provider }), now),
  ]);
  return { attemptId, ...eligibility };
}
