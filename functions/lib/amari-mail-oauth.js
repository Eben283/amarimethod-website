const encoder = new TextEncoder();

export const AMARI_MAIL_CALLBACK_URL = "https://www.amarimethod.com/api/staff-amari-mail-callback";
export const AMARI_MAIL_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.readonly",
]);
export const AMARI_MAIL_STATE_TTL_SECONDS = 10 * 60;
const STAFF_MAILBOXES = Object.freeze({
  Eben: Object.freeze({ actor: "Eben", key: "eben", sender: "eben@amarimethod.com" }),
  Garrett: Object.freeze({ actor: "Garrett", key: "garrett", sender: "garrett@amarimethod.com" }),
});

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function stateKey(secret, usage) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

async function signNonce(nonce, secret) {
  const signature = await crypto.subtle.sign("HMAC", await stateKey(secret, "sign"), encoder.encode(`amari-mail-oauth.v1.${nonce}`));
  return base64url(new Uint8Array(signature));
}

function fromBase64url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function resolveAmariMailbox(actor) {
  const mailbox = STAFF_MAILBOXES[String(actor || "").trim()];
  if (!mailbox) throw new Error("staff actor does not have an Amari mailbox");
  return { ...mailbox };
}

export function amariMailKey(actor, name) {
  const mailbox = resolveAmariMailbox(actor);
  if (!/^[a-z_]{3,40}$/.test(String(name || ""))) throw new Error("invalid Amari mail key");
  return `amari-mail:${mailbox.key}:${name}`;
}

export async function createAmariMailOAuthState(env, actor, now = Date.now()) {
  const mailbox = resolveAmariMailbox(actor);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = base64url(bytes);
  const state = `${nonce}.${await signNonce(nonce, env.JWT_SECRET)}`;
  await env.PORTAL_KV.put(
    `amari-mail:oauth-state:${nonce}`,
    JSON.stringify({ actor: mailbox.actor, requiredSender: mailbox.sender, createdAt: now }),
    { expirationTtl: AMARI_MAIL_STATE_TTL_SECONDS },
  );
  return state;
}

export async function consumeAmariMailOAuthState(env, state) {
  const [nonce, suppliedSignature, ...extra] = String(state || "").split(".");
  if (extra.length || !/^[A-Za-z0-9_-]{43}$/.test(nonce || "") || !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature || "")) return null;
  let verified = false;
  try {
    verified = await crypto.subtle.verify(
      "HMAC",
      await stateKey(env.JWT_SECRET, "verify"),
      fromBase64url(suppliedSignature),
      encoder.encode(`amari-mail-oauth.v1.${nonce}`),
    );
  } catch {
    return null;
  }
  if (!verified) return null;

  const key = `amari-mail:oauth-state:${nonce}`;
  const saved = await env.PORTAL_KV.get(key);
  await env.PORTAL_KV.delete(key);
  if (!saved) return null;
  try {
    const grant = JSON.parse(saved);
    const mailbox = resolveAmariMailbox(grant.actor);
    if (grant.requiredSender !== mailbox.sender) return null;
    return grant;
  } catch {
    return null;
  }
}

export function amariMailOAuthConfigured(env) {
  return Boolean(env?.PORTAL_KV
    && env?.JWT_SECRET
    && env?.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID
    && env?.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET);
}

export async function amariMailGrantReadiness(env, actor) {
  const mailbox = resolveAmariMailbox(actor);
  const oauthConfigured = amariMailOAuthConfigured(env);
  let grant = null;
  if (oauthConfigured) {
    try { grant = JSON.parse(await env.PORTAL_KV.get(amariMailKey(actor, "grant_status"))); } catch { grant = null; }
  }
  const grantVerified = grant?.actor === mailbox.actor
    && String(grant?.profileEmail || "").toLowerCase() === mailbox.sender
    && Array.isArray(grant?.verifiedSendAs)
    && grant.verifiedSendAs.map((address) => String(address).toLowerCase()).includes(mailbox.sender)
    && AMARI_MAIL_SCOPES.every((scope) => grant?.scopes?.includes(scope));
  const blockers = [];
  if (!oauthConfigured) blockers.push("Amari-owned Google OAuth configuration is not available");
  if (!grantVerified) blockers.push("the signed Staff actor's Amari OAuth grant and exact SendAs identity are not verified");
  blockers.push(
    "DKIM and DMARC are not verified",
    "inbound Gmail reply sync is not implemented",
    "delivery command dispatcher is not activated",
    "provider outcomes are not ingested into Communication",
  );
  return {
    actor: mailbox.actor,
    mailbox: mailbox.sender,
    oauthConfigured,
    grantVerified,
    deliveryEnabled: false,
    replySyncEnabled: false,
    fallbackProvider: null,
    blockers,
  };
}
