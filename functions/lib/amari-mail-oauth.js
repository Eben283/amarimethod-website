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
  let rawGrant = null;
  let refreshCredential = null;
  let grant = null;
  if (oauthConfigured) {
    rawGrant = await env.PORTAL_KV.get(amariMailKey(actor, "grant_status"));
    try {
      grant = JSON.parse(rawGrant);
      if (!grant || typeof grant !== "object" || Array.isArray(grant)) grant = null;
    } catch {
      grant = null;
    }
  }
  const grantPresent = rawGrant !== null && rawGrant !== undefined && rawGrant !== "";
  if (oauthConfigured && grantPresent) refreshCredential = await env.PORTAL_KV.get(amariMailKey(actor, "refresh_token"));
  const actorReady = grant?.actor === mailbox.actor;
  const profileReady = actorReady && String(grant?.profileEmail || "").trim().toLowerCase() === mailbox.sender;
  const scopesReady = actorReady
    && Array.isArray(grant?.scopes)
    && AMARI_MAIL_SCOPES.every((scope) => grant.scopes.includes(scope));
  const sendAsReady = actorReady
    && Array.isArray(grant?.verifiedSendAs)
    && grant.verifiedSendAs.map((address) => String(address).trim().toLowerCase()).includes(mailbox.sender);
  const credentialReady = typeof refreshCredential === "string" && refreshCredential.length > 0;
  const grantMarkerVerified = oauthConfigured && grantPresent && actorReady && profileReady && scopesReady && sendAsReady;
  const grantVerified = grantMarkerVerified && credentialReady;
  const configurationStatus = oauthConfigured ? "configured" : "unconfigured";
  const connectionStatus = !oauthConfigured ? "unconfigured" : !grantPresent ? "absent" : grantVerified ? "verified" : "invalid";
  const blockers = [];
  if (!oauthConfigured) blockers.push("Amari-owned Google OAuth configuration is not available");
  if (oauthConfigured && !grantPresent) blockers.push(`No verified Amari Gmail grant is connected for ${mailbox.actor}`);
  if (oauthConfigured && grantPresent && !actorReady) blockers.push(`The stored grant does not belong to ${mailbox.actor}`);
  if (oauthConfigured && grantPresent && !profileReady) blockers.push(`The connected Google profile does not match ${mailbox.sender}`);
  if (oauthConfigured && grantPresent && !scopesReady) blockers.push("The connected grant is missing required Gmail scopes");
  if (oauthConfigured && grantPresent && !sendAsReady) blockers.push(`Gmail has not verified ${mailbox.sender} as an approved SendAs identity`);
  if (grantMarkerVerified && !credentialReady) blockers.push("The verified Amari Gmail grant has no refresh credential");
  blockers.push(
    "Gmail delivery is disabled; no delivery dispatcher is active",
    "Inbound Gmail watch and ingestion are not active",
    "Gmail provider outcomes are not connected to the Communication surface",
  );
  return {
    actor: mailbox.actor,
    mailbox: mailbox.sender,
    oauthConfigured,
    configurationStatus,
    connectionStatus,
    grantPresent,
    grantConnected: grantVerified,
    grantVerified,
    profileReady,
    scopesReady,
    sendAsReady,
    credentialReady,
    deliveryEnabled: false,
    replySyncEnabled: false,
    fallbackProvider: null,
    blockers,
  };
}
