const DASHBOARD_COOKIE_NAME = "amari_crm_dashboard";
const REVIEW_COOKIE_NAME = "amari_crm_review";
const DASHBOARD_SESSION_SECONDS = 8 * 60 * 60;
const REVIEW_SESSION_SECONDS = 15 * 60;
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

async function signature(secret, cookieName, expiresAt) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${cookieName}.${expiresAt}`));
  return base64url(new Uint8Array(signed));
}


async function sessionCookie(env, cookieName, durationSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return null;
  const expiresAt = nowSeconds + durationSeconds;
  const token = `${expiresAt}.${await signature(env.WORKER_AUTH_SECRET, cookieName, expiresAt)}`;
  return `${cookieName}=${token}; Max-Age=${durationSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function hasSession(request, env, cookieName, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return false;
  const value = cookieValue(request, cookieName);
  const [expiresRaw, suppliedSignature, ...extra] = (value || "").split(".");
  const expiresAt = Number(expiresRaw);
  if (extra.length || !Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || !suppliedSignature) return false;
  return suppliedSignature === await signature(env.WORKER_AUTH_SECRET, cookieName, expiresAt);
}

export function dashboardSessionCookie(env, nowSeconds) {
  return sessionCookie(env, DASHBOARD_COOKIE_NAME, DASHBOARD_SESSION_SECONDS, nowSeconds);
}

export function reviewSessionCookie(env, nowSeconds) {
  return sessionCookie(env, REVIEW_COOKIE_NAME, REVIEW_SESSION_SECONDS, nowSeconds);
}

export function hasDashboardSession(request, env, nowSeconds) {
  return hasSession(request, env, DASHBOARD_COOKIE_NAME, nowSeconds);
}

export function hasReviewSession(request, env, nowSeconds) {
  return hasSession(request, env, REVIEW_COOKIE_NAME, nowSeconds);
}
