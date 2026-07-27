import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const STRIPE_BASE = "https://api.stripe.com/v1";

async function readJson(response, provider) {
  if (!response.ok) throw new Error(`${provider} read failed (${response.status})`);
  return response.json();
}

async function ghlGet(env, path) {
  const token = await getAccessToken(env);
  const response = await fetch(`${GHL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  return readJson(response, "GHL");
}

function parseGhlCursor(cursor) {
  if (typeof cursor !== "string") return null;
  try {
    const parsed = JSON.parse(cursor);
    if (!parsed || typeof parsed.afterId !== "string" || !parsed.afterId) return null;
    if (parsed.after == null) return null;
    return { afterId: parsed.afterId, after: parsed.after };
  } catch {
    // The first deployed version stored only an ID. Restarting that bounded import
    // once is safe because contact upserts are idempotent; resuming it is not.
    return null;
  }
}

function nextGhlCursor(meta, contactCount, limit) {
  if (contactCount < limit || !meta?.startAfterId || meta.startAfter == null) return null;
  return JSON.stringify({ afterId: meta.startAfterId, after: meta.startAfter });
}

export async function fetchGhlContactsPage(env, cursor, limit) {
  const params = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, limit: String(limit) });
  const position = parseGhlCursor(cursor);
  if (position) {
    params.set("startAfterId", position.afterId);
    params.set("startAfter", String(position.after));
  }
  const payload = await ghlGet(env, `/contacts/?${params}`);
  const contacts = Array.isArray(payload.contacts) ? payload.contacts.slice(0, limit) : [];
  return { contacts, nextCursor: nextGhlCursor(payload.meta, contacts.length, limit) };
}

export async function fetchGhlAppointmentsForContact(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}/appointments?limit=100`);
  const appointments = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.appointments)
      ? payload.appointments
      : [];
  // This is deliberately bounded. An unexpectedly large history is a review condition, not a reason to buffer it all.
  return appointments.slice(0, 100);
}

export async function fetchGhlConversationsForContact(env, contactExternalId) {
  const params = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, contactId: contactExternalId, limit: "10" });
  const payload = await ghlGet(env, `/conversations/search?${params}`);
  return Array.isArray(payload.conversations) ? payload.conversations.slice(0, 10) : [];
}

export async function fetchGhlConversationMessages(env, conversationExternalId) {
  const payload = await ghlGet(env, `/conversations/${encodeURIComponent(conversationExternalId)}/messages?limit=100`);
  const messages = payload.messages?.messages || payload.messages || [];
  return Array.isArray(messages) ? messages.slice(0, 100) : [];
}

export async function fetchStripeChargesPage(env, cursor, limit) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("starting_after", cursor);
  const response = await fetch(`${STRIPE_BASE}/charges?${params}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const payload = await readJson(response, "Stripe");
  const charges = Array.isArray(payload.data) ? payload.data.slice(0, limit) : [];
  return { charges, nextCursor: payload.has_more ? charges.at(-1)?.id || null : null };
}

export async function fetchStripeCustomer(env, customerExternalId) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!customerExternalId) return null;
  const response = await fetch(`${STRIPE_BASE}/customers/${encodeURIComponent(customerExternalId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  // Deleted customers are not an import failure. The charge remains visible for
  // review but contributes no identity evidence.
  if (response.status === 404) return null;
  return readJson(response, "Stripe customer");
}
