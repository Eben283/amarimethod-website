const DASHBOARD_COOKIE_NAME = "amari_crm_dashboard";
const REVIEW_COOKIE_NAME = "amari_crm_review";
const DASHBOARD_SESSION_SECONDS = 8 * 60 * 60;
const REVIEW_SESSION_SECONDS = 15 * 60;
const DASHBOARD_SESSION_HEADER = "X-Amari-Dashboard-Session";
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

function actorValue(actor) {
  const value = String(actor || "").trim();
  return value && /^[A-Za-z][A-Za-z .'-]{0,78}$/.test(value) ? value : "";
}

async function signature(secret, cookieName, expiresAt, actorSegment) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${cookieName}.${expiresAt}.${actorSegment}`));
  return base64url(new Uint8Array(signed));
}

async function sessionCookie(env, cookieName, durationSeconds, actor = "", nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return null;
  const expiresAt = nowSeconds + durationSeconds;
  const safeActor = actorValue(actor);
  const actorSegment = safeActor ? base64url(encoder.encode(safeActor)) : "";
  const token = `${expiresAt}.${actorSegment}.${await signature(env.WORKER_AUTH_SECRET, cookieName, expiresAt, actorSegment)}`;
  return `${cookieName}=${token}; Max-Age=${durationSeconds}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned`;
}

async function sessionValueActor(value, env, cookieName, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return null;
  const [expiresRaw, actorSegment, suppliedSignature, ...extra] = (value || "").split(".");
  const expiresAt = Number(expiresRaw);
  if (extra.length || !Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || !actorSegment || !suppliedSignature) return null;
  if (suppliedSignature !== await signature(env.WORKER_AUTH_SECRET, cookieName, expiresAt, actorSegment)) return null;
  try {
    const binary = atob(actorSegment.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return actorValue(new TextDecoder().decode(bytes)) || null;
  } catch { return null; }
}

async function hasSession(request, env, cookieName, nowSeconds) {
  return Boolean(await sessionValueActor(cookieValue(request, cookieName), env, cookieName, nowSeconds));
}

async function dashboardSessionActorFromRequest(request, env, nowSeconds) {
  const cookieActor = await sessionValueActor(cookieValue(request, DASHBOARD_COOKIE_NAME), env, DASHBOARD_COOKIE_NAME, nowSeconds);
  return cookieActor || sessionValueActor(request.headers.get(DASHBOARD_SESSION_HEADER), env, DASHBOARD_COOKIE_NAME, nowSeconds);
}

export function dashboardSessionCookie(env, actor, nowSeconds) {
  return sessionCookie(env, DASHBOARD_COOKIE_NAME, DASHBOARD_SESSION_SECONDS, actor, nowSeconds);
}

export async function dashboardSessionToken(env, actor, nowSeconds) {
  const cookie = await dashboardSessionCookie(env, actor, nowSeconds);
  return cookie ? cookie.split(";", 1)[0].slice(`${DASHBOARD_COOKIE_NAME}=`.length) : null;
}

export function reviewSessionCookie(env, nowSeconds) {
  return sessionCookie(env, REVIEW_COOKIE_NAME, REVIEW_SESSION_SECONDS, "review", nowSeconds);
}

export function hasDashboardSession(request, env, nowSeconds) {
  return dashboardSessionActorFromRequest(request, env, nowSeconds).then(Boolean);
}

export function dashboardSessionActor(request, env, nowSeconds) {
  return dashboardSessionActorFromRequest(request, env, nowSeconds);
}

export function hasReviewSession(request, env, nowSeconds) {
  return hasSession(request, env, REVIEW_COOKIE_NAME, nowSeconds);
}
