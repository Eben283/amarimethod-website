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

// The location-wide inbox is paginated separately from contacts. It supplies
// thread-level unread state and the most recent preview; messages are then
// fetched per thread so the owned timeline never depends on a UI-only summary.
export async function fetchGhlConversationsPage(env, page = 1, limit = 100) {
  const params = new URLSearchParams({
    locationId: env.GHL_LOCATION_ID,
    sortBy: "last_message_date",
    sort: "desc",
    limit: String(Math.min(100, Math.max(1, limit))),
    page: String(Math.max(1, page)),
  });
  const payload = await ghlGet(env, `/conversations/search?${params}`);
  const conversations = Array.isArray(payload.conversations) ? payload.conversations : (Array.isArray(payload.data) ? payload.data : []);
  return { conversations, nextPage: conversations.length >= limit ? page + 1 : null };
}

export async function fetchGhlConversationMessages(env, conversationExternalId, limit = 100) {
  const payload = await ghlGet(env, `/conversations/${encodeURIComponent(conversationExternalId)}/messages?limit=${Math.min(100, Math.max(1, limit))}`);
  const messages = Array.isArray(payload.messages?.messages) ? payload.messages.messages : (Array.isArray(payload.messages) ? payload.messages : []);
  return messages.slice(0, limit);
}

export async function fetchGhlMessageExport(env, cursor = null, limit = 50) {
  const params = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, limit: String(Math.min(100, Math.max(10, limit))) });
  if (cursor) params.set("cursor", cursor);
  const payload = await ghlGet(env, `/conversations/messages/export?${params}`);
  return { messages: Array.isArray(payload.messages) ? payload.messages : [], nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null };
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

export async function fetchGhlContact(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}`);
  return payload.contact || payload;
}

// Notes and tasks are contact-scoped endpoints. Unlike the contacts list, they
// reject a locationId query parameter, so use the shared authenticated reader
// directly rather than routing through a helper that adds location scope.
export async function fetchGhlContactNotes(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}/notes`);
  return Array.isArray(payload.notes) ? payload.notes : [];
}

export async function fetchGhlContactTasks(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}/tasks`);
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

// Used when a full-pass completeness cycle finds contacts the list walk did not
// refresh. GHL returns 400 "Contact not found" for deleted IDs; those are ghosts
// in the mirror, not missing source records that need operator recovery.
export async function fetchGhlContactExists(env, contactExternalId) {
  const token = await getAccessToken(env);
  const response = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactExternalId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (response.status === 400 || response.status === 404) return false;
  if (!response.ok) throw new Error(`GHL contact probe failed (${response.status})`);
  return true;
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
