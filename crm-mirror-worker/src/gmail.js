const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SEND_AS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const REQUIRED_GMAIL_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.readonly",
]);
const AMARI_MAIL_IDENTITIES = Object.freeze({
  Eben: Object.freeze({ actor: "Eben", from: "eben@amarimethod.com", replyTo: "eben@amarimethod.com" }),
  Garrett: Object.freeze({ actor: "Garrett", from: "garrett@amarimethod.com", replyTo: "garrett@amarimethod.com" }),
});
function key(actor, name) { return `amari-mail:${resolveAmariMailIdentity(actor).actor.toLowerCase()}:${name}`; }

function tokenProviderError(message, status, retryable) {
  const error = new Error(message);
  error.status = status;
  error.retryable = retryable;
  return error;
}

async function tokenStoreGet(env, storageKey) {
  try {
    return await env.PORTAL_KV.get(storageKey);
  } catch (error) {
    const status = Number(error?.status);
    throw tokenProviderError("Google Workspace token storage failed",
      Number.isInteger(status) && status > 0 ? status : 503, true);
  }
}

async function tokenStorePut(env, storageKey, value) {
  try {
    await env.PORTAL_KV.put(storageKey, value);
  } catch (error) {
    const status = Number(error?.status);
    throw tokenProviderError("Google Workspace token storage failed",
      Number.isInteger(status) && status > 0 ? status : 503, true);
  }
}

function base64url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cleanHeader(value, name, maximum) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").trim();
  if (!text || text.length > maximum) throw new Error(`invalid ${name}`);
  return text;
}

function cleanEmail(value, name) {
  const email = cleanHeader(value, name, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`invalid ${name}`);
  return email;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function resolveAmariMailIdentity(actor) {
  const identity = AMARI_MAIL_IDENTITIES[String(actor || "").trim()];
  if (!identity) throw new Error("staff actor does not have an Amari mail identity");
  return { ...identity };
}

async function requireVerifiedGrant(env, actor) {
  const identity = resolveAmariMailIdentity(actor);
  const raw = await tokenStoreGet(env, key(actor, "grant_status"));
  let grant;
  try { grant = JSON.parse(raw); } catch { grant = null; }
  if (grant?.actor !== identity.actor
    || String(grant?.profileEmail || "").toLowerCase() !== identity.from
    || !Array.isArray(grant?.verifiedSendAs)
    || !grant.verifiedSendAs.map((address) => String(address).toLowerCase()).includes(identity.from)
    || !REQUIRED_GMAIL_SCOPES.every((scope) => grant?.scopes?.includes(scope))) {
    throw new Error("Amari mail grant is not verified");
  }
  return identity;
}

export async function getGoogleWorkspaceToken(env, actor) {
  if (!env.PORTAL_KV || !env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID || !env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET) throw new Error("Amari mail is not configured");
  await requireVerifiedGrant(env, actor);
  const [access, expiryRaw] = await Promise.all([
    tokenStoreGet(env, key(actor, "access_token")),
    tokenStoreGet(env, key(actor, "token_expiry")),
  ]);
  const expiry = Number(expiryRaw || 0);
  if (access && expiry > Date.now() + REFRESH_BUFFER_MS) return access;
  return forceRefreshGoogleWorkspaceToken(env, actor);
}

// A Gmail 401 can mean the cached access token was revoked early. This actor-
// scoped seam bypasses that cache so callers can perform one bounded retry.
export async function forceRefreshGoogleWorkspaceToken(env, actor) {
  if (!env.PORTAL_KV || !env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID || !env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET) throw new Error("Amari mail is not configured");
  await requireVerifiedGrant(env, actor);
  const refresh = await tokenStoreGet(env, key(actor, "refresh_token"));
  if (!refresh) throw new Error("Google Workspace is not authorized");
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID, client_secret: env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: refresh }).toString(),
    });
  } catch (error) {
    if (error?.status || error?.retryable != null) throw error;
    throw tokenProviderError("Google Workspace token refresh failed", 503, true);
  }
  if (!response.ok) {
    throw tokenProviderError("Google Workspace token refresh failed", response.status,
      response.status === 429 || response.status >= 500);
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!payload?.access_token) throw tokenProviderError("Google Workspace token refresh failed", 502, true);
  const expiresIn = payload.expires_in == null ? 3600 : Number(payload.expires_in);
  const expiry = Date.now() + expiresIn * 1000;
  if (!Number.isInteger(expiresIn) || expiresIn <= 0 || !Number.isSafeInteger(expiry)) {
    throw tokenProviderError("Google Workspace token refresh failed", 502, true);
  }
  await Promise.all([
    tokenStorePut(env, key(actor, "access_token"), payload.access_token),
    tokenStorePut(env, key(actor, "token_expiry"), String(expiry)),
    tokenStorePut(env, key(actor, "refresh_token"), payload.refresh_token || refresh),
  ]);
  return payload.access_token;
}

export function gmailConfigured(env) {
  return Boolean(env?.PORTAL_KV && env?.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID && env?.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET);
}

// Gmail, not the Staff UI, is the authority for usable From identities. This
// endpoint needs gmail.settings.basic; it never reads client email content.
export async function listGmailSenders(env, actor) {
  const expected = resolveAmariMailIdentity(actor).from;
  const token = await getGoogleWorkspaceToken(env, actor);
  const response = await fetch(GMAIL_SEND_AS_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Gmail sender identities unavailable (${response.status})`);
  const payload = await response.json();
  return (payload.sendAs || [])
    .filter((identity) => identity?.sendAsEmail
      && expected === String(identity.sendAsEmail).trim().toLowerCase()
      && (identity.isPrimary || String(identity.verificationStatus || "").toLowerCase() === "accepted"))
    .map((identity) => ({
      address: cleanEmail(identity.sendAsEmail, "sender"),
      name: String(identity.displayName || "").replace(/[\r\n]+/g, " ").trim(),
      isDefault: Boolean(identity.isDefault),
      isPrimary: Boolean(identity.isPrimary),
    }));
}

export async function sendGmailEmail(env, message) {
  if (Object.hasOwn(message || {}, "from") || Object.hasOwn(message || {}, "replyTo")) {
    throw new Error("sender identity is server-owned");
  }
  const { to, subject, text, preheader, actor } = message || {};
  const identity = resolveAmariMailIdentity(actor);
  const recipient = cleanEmail(to, "recipient");
  const sender = identity.from;
  const allowedSenders = await listGmailSenders(env, actor);
  if (!allowedSenders.some((identity) => identity.address === sender)) throw new Error("sender is not authorized by Google Workspace");
  const safeSubject = cleanHeader(subject, "subject", 160);
  const body = String(text || "").trim();
  if (!body || body.length > 20_000) throw new Error("invalid email body");
  const preview = preheader == null ? "" : cleanHeader(preheader, "preheader", 240);
  const contentType = preview ? "multipart/alternative; boundary=amari-boundary" : "text/plain; charset=UTF-8";
  const content = preview
    ? [
      "--amari-boundary",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      "--amari-boundary",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      `<div style=\"display:none!important;max-height:0;overflow:hidden;opacity:0;color:transparent\">${escapeHtml(preview)}</div><div style=\"white-space:pre-wrap\">${escapeHtml(body)}</div>`,
      "--amari-boundary--",
    ].join("\r\n")
    : body;
  const raw = [
    `From: ${sender}`,
    `Reply-To: ${identity.replyTo}`,
    `To: ${recipient}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}`,
    "Content-Transfer-Encoding: 8bit",
    "",
    content,
  ].join("\r\n");
  const token = await getGoogleWorkspaceToken(env, actor);
  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64url(raw) }),
  });
  if (!response.ok) throw new Error(`Gmail delivery failed (${response.status})`);
  const payload = await response.json();
  if (!payload.id) throw new Error("Gmail delivery failed");
  return { id: String(payload.id), threadId: payload.threadId ? String(payload.threadId) : null };
}
