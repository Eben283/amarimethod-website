const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const USER = "eben";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function key(name) { return `google:${USER}:${name}`; }

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

export async function getGoogleWorkspaceToken(env) {
  if (!env.PORTAL_KV || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new Error("Google Workspace is not configured");
  const [access, expiryRaw] = await Promise.all([env.PORTAL_KV.get(key("access_token")), env.PORTAL_KV.get(key("token_expiry"))]);
  const expiry = Number(expiryRaw || 0);
  if (access && expiry > Date.now() + REFRESH_BUFFER_MS) return access;
  const refresh = await env.PORTAL_KV.get(key("refresh_token"));
  if (!refresh) throw new Error("Google Workspace is not authorized");
  const response = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: refresh }).toString(),
  });
  if (!response.ok) throw new Error("Google Workspace token refresh failed");
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Google Workspace token refresh failed");
  await Promise.all([
    env.PORTAL_KV.put(key("access_token"), payload.access_token),
    env.PORTAL_KV.put(key("token_expiry"), String(Date.now() + Number(payload.expires_in || 3600) * 1000)),
    env.PORTAL_KV.put(key("refresh_token"), payload.refresh_token || refresh),
  ]);
  return payload.access_token;
}

export function gmailConfigured(env) {
  return Boolean(env?.PORTAL_KV && env?.GOOGLE_OAUTH_CLIENT_ID && env?.GOOGLE_OAUTH_CLIENT_SECRET);
}

export async function sendGmailEmail(env, { to, subject, text }) {
  const recipient = cleanHeader(to, "recipient", 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("invalid recipient");
  const safeSubject = cleanHeader(subject, "subject", 160);
  const body = String(text || "").trim();
  if (!body || body.length > 20_000) throw new Error("invalid email body");
  const raw = [
    `To: ${recipient}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  const token = await getGoogleWorkspaceToken(env);
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
