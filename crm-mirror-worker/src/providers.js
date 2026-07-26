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

export async function fetchGhlContactsPage(env, cursor, limit) {
  const params = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, limit: String(limit) });
  if (cursor) params.set("startAfterId", cursor);
  const payload = await ghlGet(env, `/contacts/?${params}`);
  const contacts = Array.isArray(payload.contacts) ? payload.contacts.slice(0, limit) : [];
  const hasMore = Boolean(payload.meta?.nextPageUrl || payload.meta?.hasMore || contacts.length === limit);
  return { contacts, nextCursor: hasMore ? contacts.at(-1)?.id || null : null };
}

export async function fetchGhlAppointmentsForContact(env, contactExternalId) {
  const payload = await ghlGet(env, `/contacts/${encodeURIComponent(contactExternalId)}/appointments?limit=100`);
  const appointments = Array.isArray(payload.appointments) ? payload.appointments : [];
  // This is deliberately bounded. An unexpectedly large history is a review condition, not a reason to buffer it all.
  return appointments.slice(0, 100);
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
