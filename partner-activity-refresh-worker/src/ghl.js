// GHL API helpers for the partner-activity-refresh Worker.
// Tokens are managed in PORTAL_KV by the ghl-token-refresh worker.
// Mirrors daily-audit-worker/src/ghl.js but adds POST + PUT support.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = `${GHL_BASE}/oauth/token`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";

export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field id for the partner_last_real_activity field — only one we write.
export const PARTNER_LAST_REAL_ACTIVITY_FIELD_ID = "W7JoyJKPKhPI8hZ5EgUv";

// All tags that identify a partner-tagged contact (union, dedup'd on id).
export const PARTNER_TAGS = [
  "golf-new-partner",
  "tennis-new-partner",
  "trainer-new-partner",
  "trainer-outreach",
  "partner-prospect",
  "affiliate-partner",
  "ambassador-prospect",
];

// ── Token management ──

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

// ── Generic GHL fetch helpers ──

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
  // PUT /contacts/{id} returns the contact; some endpoints return empty body — handle both
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export const ghlGet = (env, path) => ghlRequest(env, "GET", path);
export const ghlPost = (env, path, body) => ghlRequest(env, "POST", path, body);
export const ghlPut = (env, path, body) => ghlRequest(env, "PUT", path, body);

// ── High-level helpers used by the worker ──

// Paginate /contacts/search across all partner tags. Returns deduped Map(id → contact).
export async function fetchAllPartnerContacts(env) {
  const byId = new Map();
  for (const tag of PARTNER_TAGS) {
    let page = 1;
    let safety = 0;
    while (safety < 10) {
      const data = await ghlPost(env, "/contacts/search", {
        locationId: LOCATION_ID,
        pageLimit: 100,
        page,
        filters: [{ field: "tags", operator: "contains", value: tag }],
      });
      const contacts = data.contacts || [];
      for (const c of contacts) if (!byId.has(c.id)) byId.set(c.id, c);
      if (contacts.length < 100) break;
      page += 1;
      safety += 1;
    }
  }
  return byId;
}

// For one contact: find the most-recent message date across conversations.
// Returns ISO string or null. Mirrors the logic of ops/scripts/backfill-partner-last-activity.mjs.
export async function findMostRecentMessageDate(env, contactId) {
  const convData = await ghlGet(env, `/conversations/search?contactId=${encodeURIComponent(contactId)}&locationId=${LOCATION_ID}`);
  const conversations = (convData.conversations || []).slice(0, 5);
  if (conversations.length === 0) return null;

  let bestDate = null;
  const needsMessageFetch = [];
  for (const c of conversations) {
    const stamp = c.lastMessageDate || c.lastMessage?.dateAdded;
    if (stamp) {
      const t = new Date(stamp).getTime();
      if (Number.isFinite(t) && (!bestDate || t > bestDate)) bestDate = t;
    } else {
      needsMessageFetch.push(c.id);
    }
  }

  // Fallback: fetch messages only for threads missing the stamp
  for (const convId of needsMessageFetch) {
    const msgData = await ghlGet(env, `/conversations/${convId}/messages?limit=20`);
    const messages = msgData.messages?.messages || [];
    for (const m of messages) {
      const t = new Date(m.dateAdded || m.date).getTime();
      if (Number.isFinite(t) && (!bestDate || t > bestDate)) bestDate = t;
    }
  }

  return bestDate ? new Date(bestDate).toISOString() : null;
}

// PUT the partner_last_real_activity field on one contact.
export async function writeLastActivity(env, contactId, isoDate) {
  return ghlPut(env, `/contacts/${contactId}`, {
    customFields: [{ id: PARTNER_LAST_REAL_ACTIVITY_FIELD_ID, value: isoDate }],
  });
}
