const COOKIE_NAME = "amari_automation_dashboard";
const SESSION_HEADER = "X-Amari-Automation-Dashboard-Session";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cookieValue(request) {
  const prefix = `${COOKIE_NAME}=`;
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

function actorValue(actor) {
  const value = String(actor || "").trim();
  return value && /^[A-Za-z][A-Za-z .'-]{0,78}$/.test(value) ? value : "";
}

async function signature(secret, expiresAt, actorSegment) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC", key, encoder.encode(`${COOKIE_NAME}.${expiresAt}.${actorSegment}`),
  );
  return base64url(new Uint8Array(signed));
}

export async function dashboardSessionToken(env, actor, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return null;
  const expiresAt = nowSeconds + SESSION_SECONDS;
  const safeActor = actorValue(actor);
  const actorSegment = safeActor ? base64url(encoder.encode(safeActor)) : "";
  const token = `${expiresAt}.${actorSegment}.${await signature(env.WORKER_AUTH_SECRET, expiresAt, actorSegment)}`;
  return token;
}

export async function dashboardSessionCookie(env, actor, nowSeconds = Math.floor(Date.now() / 1000)) {
  const token = await dashboardSessionToken(env, actor, nowSeconds);
  return token ? `${COOKIE_NAME}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned` : null;
}

export async function hasDashboardSession(request, env, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!env.WORKER_AUTH_SECRET) return false;
  const supplied = cookieValue(request) || request.headers.get(SESSION_HEADER) || "";
  const [expiresRaw, actorSegment, suppliedSignature, ...extra] = supplied.split(".");
  const expiresAt = Number(expiresRaw);
  if (extra.length || !Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || !actorSegment || !suppliedSignature) return false;
  return suppliedSignature === await signature(env.WORKER_AUTH_SECRET, expiresAt, actorSegment);
}
