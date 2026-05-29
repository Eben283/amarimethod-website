// GHL API helpers for series-reconcile-worker.
// Tokens managed in PORTAL_KV by ghl-token-refresh worker.
// Pattern mirrors partner-activity-refresh-worker/src/ghl.js.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = `${GHL_BASE}/oauth/token`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";

export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

async function refreshToken(env) {
  const kv = env.PORTAL_KV;
  const refreshTok = await kv.get(KV_REFRESH_TOKEN);
  if (!refreshTok) throw new Error("No refresh token in KV");

  const { GHL_CLIENT_ID: clientId, GHL_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) throw new Error("Missing GHL_CLIENT_ID or GHL_CLIENT_SECRET");

  const res = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshTok,
    }).toString(),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

  const data = await res.json();
  const newExpiry = Date.now() + (data.expires_in || 86399) * 1000;

  await Promise.all([
    kv.put(KV_ACCESS_TOKEN, data.access_token),
    kv.put(KV_REFRESH_TOKEN, data.refresh_token || refreshTok),
    kv.put(KV_TOKEN_EXPIRY, String(newExpiry)),
  ]);

  return data.access_token;
}

export async function getAccessToken(env) {
  const kv = env.PORTAL_KV;
  if (!kv) throw new Error("PORTAL_KV binding not available");

  const [accessToken, expiryStr] = await Promise.all([
    kv.get(KV_ACCESS_TOKEN),
    kv.get(KV_TOKEN_EXPIRY),
  ]);
  const expiry = Number(expiryStr || 0);
  if (accessToken && expiry && Date.now() < expiry - REFRESH_BUFFER_MS) {
    return accessToken;
  }
  return await refreshToken(env);
}

async function ghlRequest(env, method, path, body) {
  const token = await getAccessToken(env);
  const url = `${GHL_BASE}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
  };
  if (body !== undefined) opts.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL ${method} ${path} ${res.status}: ${errText.slice(0, 250)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export const ghlGet = (env, path) => ghlRequest(env, "GET", path);
export const ghlPost = (env, path, body) => ghlRequest(env, "POST", path, body);
export const ghlPut = (env, path, body) => ghlRequest(env, "PUT", path, body);

// ── Domain helpers ──

// List completed orders, optionally limited to those updated after `sinceMs`.
// GHL's /payments/orders endpoint doesn't accept a date filter directly — we
// page through and stop when we cross the cutoff (orders come back sorted
// most-recent-first per `updatedAt`).
export async function listRecentCompletedOrders(env, sinceMs) {
  const orders = [];
  let offset = 0;
  const PAGE = 50;
  const MAX_PAGES = 6; // 300 orders ceiling — typical activity << this
  for (let p = 0; p < MAX_PAGES; p++) {
    const data = await ghlGet(
      env,
      `/payments/orders?altId=${LOCATION_ID}&altType=location&status=completed&limit=${PAGE}&offset=${offset}`
    );
    const batch = data.data || [];
    if (batch.length === 0) break;
    let crossed = false;
    for (const o of batch) {
      const t = new Date(o.updatedAt || o.createdAt).getTime();
      if (!Number.isFinite(t)) continue;
      if (t < sinceMs) { crossed = true; continue; }
      orders.push(o);
    }
    if (crossed || batch.length < PAGE) break;
    offset += PAGE;
  }
  return orders;
}

export async function getOrderDetail(env, orderId) {
  return ghlGet(env, `/payments/orders/${orderId}?altId=${LOCATION_ID}&altType=location`);
}

export async function getContact(env, contactId) {
  const data = await ghlGet(env, `/contacts/${contactId}`);
  return data.contact;
}

// PATCH a contact's custom fields + (optional) tags.
export async function patchContact(env, contactId, customFields, tags) {
  const body = { customFields };
  if (Array.isArray(tags)) body.tags = tags;
  return ghlPut(env, `/contacts/${contactId}`, body);
}

export async function addContactNote(env, contactId, body) {
  return ghlPost(env, `/contacts/${contactId}/notes`, { body });
}
