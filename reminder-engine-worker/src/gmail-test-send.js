// Gmail transport for the one-contact Assessment proof. It is not a general dispatcher: caller
// allowlisting is mandatory, credentials stay in KV, and the outcome is returned for evidence.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

function base64url(value) {
  const bytes = new TextEncoder().encode(value);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function gmailAccessToken(env) {
  const kv = env.PORTAL_KV;
  const [access, expiry, refresh] = await Promise.all([
    kv?.get("amari-mail:eben:access_token"), kv?.get("amari-mail:eben:token_expiry"), kv?.get("amari-mail:eben:refresh_token"),
  ]);
  if (access && Number(expiry) > Date.now() + TOKEN_BUFFER_MS) return access;
  if (!refresh || !env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID || !env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET) throw new Error("Amari Gmail delivery is not connected");
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID, client_secret: env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET }).toString() });
  if (!response.ok) throw new Error(`Gmail token refresh ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error("Gmail token refresh returned no access token");
  await Promise.all([kv.put("amari-mail:eben:access_token", data.access_token), kv.put("amari-mail:eben:token_expiry", String(Date.now() + Number(data.expires_in || 3600) * 1000))]);
  return data.access_token;
}

export async function sendAssessmentTestEmail(env, { to, subject, text, html }) {
  const token = await gmailAccessToken(env);
  const raw = [
    "From: Amari Method <eben@amarimethod.com>", `To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: multipart/alternative; boundary=amari-test-boundary", "",
    "--amari-test-boundary", "Content-Type: text/plain; charset=UTF-8", "", text,
    "--amari-test-boundary", "Content-Type: text/html; charset=UTF-8", "", html,
    "--amari-test-boundary--",
  ].join("\r\n");
  const response = await fetch(SEND_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: base64url(raw) }) });
  if (!response.ok) return { success: false, error: `Gmail rejected send (${response.status})` };
  const data = await response.json();
  return { success: true, messageId: data.id || null };
}
