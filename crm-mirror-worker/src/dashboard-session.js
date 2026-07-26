const COOKIE_NAME = "amari_crm_dashboard";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cookieValue(request, name) {
  const prefix = `${name}=`;
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
}

async function signature(secret, expiresAt) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${COOKIE_NAME}.${expiresAt}`));
  return base64url(new Uint8Array(signed));
}

export async function dashboardSessionCookie(env, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return null;
  const expiresAt = nowSeconds + SESSION_SECONDS;
  const token = `${expiresAt}.${await signature(env.WORKER_AUTH_SECRET, expiresAt)}`;
  return `${COOKIE_NAME}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function hasDashboardSession(request, env, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return false;
  const value = cookieValue(request, COOKIE_NAME);
  const [expiresRaw, suppliedSignature, ...extra] = (value || "").split(".");
  const expiresAt = Number(expiresRaw);
  if (extra.length || !Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || !suppliedSignature) return false;
  return suppliedSignature === await signature(env.WORKER_AUTH_SECRET, expiresAt);
}
