// GHL API helpers for the call-coach Cloudflare Worker.
// Tokens are managed in PORTAL_KV by the ghl-token-refresh worker (shared with
// daily-audit). This mirrors daily-audit-worker/src/ghl.js getAccessToken +
// ghlFetch, then adds call-coach-specific helpers (call enumeration, recording
// download, outgoing-text fetch).

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = `${GHL_BASE}/oauth/token`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";

export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// GHL message-type codes (numeric, from /conversations/{id}/messages).
// Calls: 1 CALL, 8 CAMPAIGN_CALL, 13 CAMPAIGN_MANUAL_CALL, 22 IVR_CALL.
// SMS: 2,7,14,20,4,6. Email: 3,9,21.
const CALL_TYPES = new Set([1, 8, 13, 22]);
const SMS_TYPES = new Set([2, 7, 14, 20, 4, 6]);
const EMAIL_TYPES = new Set([3, 9, 21]);

function isCallType(t) {
  if (typeof t === "number") return CALL_TYPES.has(t);
  if (typeof t === "string") {
    const n = Number(t);
    if (Number.isFinite(n) && String(n) === t.trim()) return CALL_TYPES.has(n);
    return t.toUpperCase().includes("CALL");
  }
  return false;
}
function isSmsType(t) {
  if (typeof t === "number") return SMS_TYPES.has(t);
  if (typeof t === "string") {
    const n = Number(t);
    if (Number.isFinite(n) && String(n) === t.trim()) return SMS_TYPES.has(n);
    return t.toUpperCase().includes("SMS");
  }
  return false;
}
function isEmailType(t) {
  if (typeof t === "number") return EMAIL_TYPES.has(t);
  if (typeof t === "string") {
    const n = Number(t);
    if (Number.isFinite(n) && String(n) === t.trim()) return EMAIL_TYPES.has(n);
    return t.toUpperCase().includes("EMAIL");
  }
  return false;
}

export function isOutbound(m) {
  return m.direction === 0 || m.direction === "outbound";
}

// ── Token management (KV-backed, shared with ghl-token-refresh) ──

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
  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  if (accessToken && expiry > Date.now() + REFRESH_BUFFER_MS) return accessToken;
  return refreshToken(env);
}

function ghlHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    ...extra,
  };
}

// JSON GHL fetch. Auto-appends locationId unless the path already carries a
// location/altId param (matches daily-audit-worker/src/ghl.js semantics).
export async function ghlFetch(env, path) {
  const token = await getAccessToken(env);
  const url = new URL(`${GHL_BASE}${path}`);
  if (!url.searchParams.has("locationId") && !url.searchParams.has("altId")) {
    url.searchParams.set("locationId", LOCATION_ID);
  }
  const res = await fetch(url.toString(), { headers: ghlHeaders(token) });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL API ${res.status}: ${errText}`);
  }
  return res.json();
}

// ── Pacific Time helpers ──

const PT = "America/Los_Angeles";

export function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(new Date());
}

export function yesterdayPacific() {
  const d = new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(d);
}

// Convert a YYYY-MM-DD (Pacific) into a UTC epoch-ms day range.
export function dateToRange(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 20, 0, 0));
  const ptHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: PT, hour: "2-digit", hour12: false }).format(probe)
  );
  const utcHourForMidnight = 20 - ptHour;
  const startMs = Date.UTC(year, month - 1, day, utcHourForMidnight, 0, 0);
  return { startMs, endMs: startMs + 86_400_000 - 1 };
}

// ── Conversation / message fetching ──
// GHL double-nests: msgData.messages?.messages

async function fetchMessages(env, conversationId, limit = 100) {
  const data = await ghlFetch(env, `/conversations/${conversationId}/messages?limit=${limit}`);
  return data.messages?.messages || [];
}

// Enumerate conversations touched in the [startMs, endMs] window, then pull each
// one's FULL message history (not just the in-window slice) so the coach sees the
// WHOLE relationship, not one day. Returns a per-contact bundle:
//   { contactId, contactName, triggerCalls, calls, thread, hadWindowActivity }
//
// - triggerCalls = calls that landed IN the window (the fresh thing to coach +
//   transcribe live).
// - calls        = ALL calls on record (any date); prior ones get their cached
//   transcript from KV so the coach has earlier-call content for free.
// - thread        = the COMPLETE two-way SMS/email history, BOTH directions —
//   so the contact's own replies are visible (the whole point of this fix).
// Only contacts with in-window activity are returned (something new to coach).
export async function fetchRelationshipBundles(env, startMs, endMs, { minCallDuration = 10, maxConversations = 60, maxThread = 40, maxCalls = 6 } = {}) {
  const search = await ghlFetch(env, `/conversations/search?limit=${maxConversations}`);
  const conversations = search.conversations || [];

  // Pre-filter to conversations touched at/after the window start — those are the
  // ones with something new. We still read each one's full history below.
  const recent = conversations.filter((c) => {
    const last = new Date(c.lastMessageDate || c.dateUpdated || 0).getTime();
    return last >= startMs;
  });

  const byContact = new Map();
  for (const conv of recent) {
    let msgs;
    try { msgs = await fetchMessages(env, conv.id); }
    catch { continue; }

    for (const m of msgs) {
      const contactId = m.contactId || conv.contactId;
      if (!contactId) continue;
      const ts = new Date(m.dateAdded || m.date || 0).getTime();
      const inWindow = ts >= startMs && ts <= endMs;
      const outbound = isOutbound(m);

      const bucket = byContact.get(contactId) || {
        contactId,
        contactName: conv.contactName || conv.fullName || null,
        triggerCalls: [],
        calls: [],
        thread: [],
        hadWindowActivity: false,
      };

      const t = m.messageType || m.type;
      if (isCallType(t)) {
        const dur = m.meta?.call?.duration || 0;
        if (dur >= minCallDuration) {
          const rec = {
            messageId: m.id,
            direction: outbound ? "outbound" : "inbound",
            duration: dur,
            date: m.dateAdded || m.date,
            isTrigger: inWindow,
          };
          bucket.calls.push(rec);
          if (inWindow) { bucket.triggerCalls.push(rec); bucket.hadWindowActivity = true; }
        }
      } else if (isSmsType(t) || isEmailType(t)) {
        const body = (m.body || m.message || "").toString();
        if (body.trim()) {
          bucket.thread.push({
            direction: outbound ? "outbound" : "inbound",
            channel: isEmailType(t) ? "email" : "sms",
            date: m.dateAdded || m.date,
            body: stripHtml(body).slice(0, 1500),
          });
          // An outgoing text in-window is itself a coachable trigger.
          if (inWindow && outbound) bucket.hadWindowActivity = true;
        }
      }
      byContact.set(contactId, bucket);
    }
  }

  const byDate = (a, b) => new Date(a.date) - new Date(b.date);
  const out = [];
  for (const b of byContact.values()) {
    if (!b.hadWindowActivity) continue;
    b.thread.sort(byDate);
    b.calls.sort(byDate);
    if (b.thread.length > maxThread) b.thread = b.thread.slice(-maxThread);
    if (b.calls.length > maxCalls) b.calls = b.calls.slice(-maxCalls);
    out.push(b);
  }
  return out;
}

// Build the FULL relationship bundle for ONE contact, no date window — used by
// the synchronous /coach-one endpoint to (re)generate a single card on demand.
// Same shape as fetchRelationshipBundles' items. The most recent call is marked
// isTrigger so an un-cached latest call still gets transcribed live.
export async function fetchContactRelationship(env, contactId, { maxThread = 40, maxCalls = 6 } = {}) {
  const s = await ghlFetch(env, `/conversations/search?contactId=${contactId}`);
  const convs = s.conversations || [];
  let contactName = null;
  const calls = [];
  const thread = [];
  for (const conv of convs) {
    contactName = contactName || conv.contactName || conv.fullName || null;
    let msgs;
    try { msgs = await fetchMessages(env, conv.id); }
    catch { continue; }
    for (const m of msgs) {
      const t = m.messageType || m.type;
      const outbound = isOutbound(m);
      if (isCallType(t)) {
        const dur = m.meta?.call?.duration || 0;
        calls.push({ messageId: m.id, direction: outbound ? "outbound" : "inbound", duration: dur, date: m.dateAdded || m.date, isTrigger: false });
      } else if (isSmsType(t) || isEmailType(t)) {
        const body = (m.body || m.message || "").toString();
        if (body.trim()) {
          thread.push({ direction: outbound ? "outbound" : "inbound", channel: isEmailType(t) ? "email" : "sms", date: m.dateAdded || m.date, body: stripHtml(body).slice(0, 1500) });
        }
      }
    }
  }
  const byDate = (a, b) => new Date(a.date) - new Date(b.date);
  calls.sort(byDate);
  thread.sort(byDate);
  if (calls.length) calls[calls.length - 1].isTrigger = true; // latest call → transcribe if uncached
  return {
    contactId,
    contactName,
    calls: calls.slice(-maxCalls),
    thread: thread.slice(-maxThread),
    hadWindowActivity: true,
  };
}

// Download a GHL call recording as an ArrayBuffer.
// Spike 0 (2026-06-13): the working endpoint shape is
//   GET /conversations/messages/{messageId}/locations/{locationId}/recording
// → 200 audio/x-wav (16-bit PCM mono 8kHz). NOTE the order: messageId BEFORE
// locations/{locationId}. The /conversations/messages/{id}/recording and
// /conversations/locations/{loc}/messages/{id}/recording shapes both 404.
// This path already carries the locationId, so we DON'T use ghlFetch (which
// would append a stray ?locationId). Returns null on any non-200 / empty body
// (e.g. the call was never recorded).
export async function fetchRecording(env, messageId) {
  const token = await getAccessToken(env);
  const url = `${GHL_BASE}/conversations/messages/${messageId}/locations/${LOCATION_ID}/recording`;
  const res = await fetch(url, { headers: ghlHeaders(token, { Accept: "audio/x-wav" }) });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (!buf || buf.byteLength < 1000) return null; // empty / silence placeholder
  const contentType = res.headers.get("content-type") || "audio/wav";
  return { buffer: buf, contentType, bytes: buf.byteLength };
}

// Try GHL's own stored transcription first (free when present). Spike showed
// the route exists but returns 400 "does not exist" when none is stored, which
// is the common case here — so this is a cheap optimistic check before we spend
// a Whisper call. Returns the transcript string or null.
export async function fetchStoredTranscription(env, messageId) {
  const token = await getAccessToken(env);
  const url = `${GHL_BASE}/conversations/locations/${LOCATION_ID}/messages/${messageId}/transcription`;
  const res = await fetch(url, { headers: ghlHeaders(token) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  // GHL returns an array of segments OR a transcriptions array, depending on
  // version. Normalize to a single string.
  const segs = data.transcriptions || data.transcript || data.segments || [];
  if (Array.isArray(segs) && segs.length) {
    const text = segs.map((s) => (typeof s === "string" ? s : s.transcript || s.text || "")).join(" ").trim();
    return text || null;
  }
  if (typeof data.transcript === "string" && data.transcript.trim()) return data.transcript.trim();
  return null;
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
