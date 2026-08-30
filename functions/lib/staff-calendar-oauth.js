import { getGoogleToken } from "./google-api.js";

export const PERSONAL_CALENDAR_CALLBACK_URL = "https://www.amarimethod.com/api/cos-google-callback";
export const AMARI_CALENDAR_CALLBACK_URL = "https://www.amarimethod.com/api/staff-amari-mail-callback";
export const STAFF_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const STAFF_CALENDAR_STATE_TTL_SECONDS = 10 * 60;
const STAFF_CALENDAR_STATE_VERSION = "staff-calendar-oauth.v2";
const STAFF_CALENDAR_STATE_PREFIX = "sc2";
const STAFF_CALENDAR_RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const WRITABLE_CALENDAR_ROLES = new Set(["owner", "writer", "writerWithoutPrivateAccess"]);
const encoder = new TextEncoder();

const ACTORS = Object.freeze({
  Eben: Object.freeze({ actor: "Eben", key: "eben", primaryCalendarId: "eben@ebenforrest.com" }),
  Garrett: Object.freeze({ actor: "Garrett", key: "garrett", primaryCalendarId: "garrett@amarimethod.com" }),
});

export function resolveStaffCalendarActor(actor) {
  const identity = ACTORS[String(actor || "").trim()];
  if (!identity) throw new Error("staff actor does not have governed calendar identity");
  return { ...identity };
}

export function staffCalendarKey(actor, name) {
  const identity = resolveStaffCalendarActor(actor);
  if (!/^[a-z_]{3,40}$/.test(String(name || ""))) throw new Error("invalid Staff calendar key");
  return `google:${identity.key}:${name}`;
}

export function staffCalendarOAuthClient(env, actor) {
  const identity = resolveStaffCalendarActor(actor);
  if (identity.actor === "Garrett") {
    return {
      clientId: env?.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env?.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET,
      callbackUrl: AMARI_CALENDAR_CALLBACK_URL,
      credentialFamily: "amari_internal",
    };
  }
  return {
    clientId: env?.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env?.GOOGLE_OAUTH_CLIENT_SECRET,
    callbackUrl: PERSONAL_CALENDAR_CALLBACK_URL,
    credentialFamily: "personal_workspace",
  };
}

export function staffCalendarOAuthConfigured(env, actor) {
  if (!env?.PORTAL_KV || !env?.JWT_SECRET) return false;
  const client = staffCalendarOAuthClient(env, actor);
  return Boolean(client.clientId && client.clientSecret);
}

function stateValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function stateKey(secret, usage) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

async function signState(payload, secret) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await stateKey(secret, "sign"),
    encoder.encode(`${STAFF_CALENDAR_STATE_VERSION}.${payload}`),
  );
  return base64url(new Uint8Array(signature));
}

function stateFailure(code, stage = "state") {
  const error = new Error("Staff calendar authorization state was not accepted");
  error.code = code;
  error.stage = stage;
  return error;
}

function exchangeFailure(message, code, stage, httpStatus = null) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  if (httpStatus) error.httpStatus = httpStatus;
  return error;
}

export function isStaffCalendarOAuthState(state) {
  return String(state || "").startsWith(`${STAFF_CALENDAR_STATE_PREFIX}.`);
}

export async function createStaffCalendarOAuthState(env, actor, now = Date.now()) {
  const identity = resolveStaffCalendarActor(actor);
  const nonce = stateValue();
  const payload = base64url(encoder.encode(JSON.stringify({
    flow: "staff_appointment_calendar",
    actor: identity.actor,
    requiredPrimaryCalendarId: identity.primaryCalendarId,
    nonce,
    createdAt: now,
  })));
  const state = `${STAFF_CALENDAR_STATE_PREFIX}.${payload}.${await signState(payload, env.JWT_SECRET)}`;
  await env.PORTAL_KV.put(
    `staff-calendar:oauth-state:${nonce}`,
    JSON.stringify({
      flow: "staff_appointment_calendar",
      actor: identity.actor,
      requiredPrimaryCalendarId: identity.primaryCalendarId,
      nonce,
      createdAt: now,
    }),
    { expirationTtl: STAFF_CALENDAR_STATE_TTL_SECONDS },
  );
  return state;
}

export async function consumeStaffCalendarOAuthState(env, state, now = Date.now()) {
  if (!isStaffCalendarOAuthState(state)) return null;
  const [prefix, encoded, suppliedSignature, ...extra] = String(state).split(".");
  if (prefix !== STAFF_CALENDAR_STATE_PREFIX || extra.length || !/^[A-Za-z0-9_-]{40,900}$/.test(encoded || "") || !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature || "")) {
    throw stateFailure("state_invalid");
  }
  let verified = false;
  try {
    verified = await crypto.subtle.verify(
      "HMAC",
      await stateKey(env.JWT_SECRET, "verify"),
      fromBase64url(suppliedSignature),
      encoder.encode(`${STAFF_CALENDAR_STATE_VERSION}.${encoded}`),
    );
  } catch (error) {
    if (error?.code) throw error;
    throw stateFailure("state_invalid");
  }
  if (!verified) throw stateFailure("state_invalid");

  let grant;
  try {
    grant = JSON.parse(new TextDecoder().decode(fromBase64url(encoded)));
    const identity = resolveStaffCalendarActor(grant.actor);
    const createdAt = Number(grant.createdAt);
    if (grant.flow !== "staff_appointment_calendar"
        || grant.requiredPrimaryCalendarId !== identity.primaryCalendarId
        || !/^[A-Za-z0-9_-]{43}$/.test(String(grant.nonce || ""))
        || !Number.isFinite(createdAt)
        || createdAt > now + 60_000
        || now - createdAt > STAFF_CALENDAR_STATE_TTL_SECONDS * 1000) {
      throw stateFailure("state_expired");
    }
  } catch (error) {
    if (error?.code) throw error;
    throw stateFailure("state_invalid");
  }

  const key = `staff-calendar:oauth-state:${grant.nonce}`;
  const saved = await env.PORTAL_KV.get(key);
  await env.PORTAL_KV.delete(key);
  if (saved) {
    try {
      const stored = JSON.parse(saved);
      if (stored.actor !== grant.actor || stored.requiredPrimaryCalendarId !== grant.requiredPrimaryCalendarId || stored.nonce !== grant.nonce) {
        throw stateFailure("state_mismatch");
      }
    } catch (error) {
      if (error?.code) throw error;
      throw stateFailure("state_invalid");
    }
  }
  // Cloudflare KV is eventually consistent. The signed, time-bounded state is
  // the callback authority when an immediate cross-PoP read cannot yet see the
  // just-written nonce. Google's authorization code remains single-use and is
  // bound to this exact client and redirect URI.
  return { ...grant, stateEvidence: saved ? "signature_and_kv" : "signature_only" };
}

export async function recordStaffCalendarOAuthResult(env, actor, result, now = Date.now()) {
  const identity = resolveStaffCalendarActor(actor);
  const status = result?.status === "connected" ? "connected" : "failed";
  const stage = /^[a-z_]{3,40}$/.test(String(result?.stage || "")) ? String(result.stage) : "unknown";
  const code = /^[a-z0-9_]{3,64}$/.test(String(result?.code || "")) ? String(result.code) : "authorization_failed";
  await env.PORTAL_KV.put(staffCalendarKey(identity.actor, "last_oauth_result"), JSON.stringify({
    actor: identity.actor,
    status,
    stage,
    code,
    at: new Date(now).toISOString(),
    bookingActivationEnabled: false,
  }), { expirationTtl: STAFF_CALENDAR_RESULT_TTL_SECONDS });
}

export async function listWritableGoogleCalendars(accessToken) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250&showHidden=true", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Google Calendar ${response.status} readiness probe failed`);
  const body = await response.json();
  if (body?.nextPageToken) throw new Error("Google Calendar writer list exceeded the exact bounded page");
  return (body?.items || [])
    .filter((item) => !item.deleted && WRITABLE_CALENDAR_ROLES.has(item.accessRole))
    .map((item) => ({
      id: String(item.id || ""),
      summary: String(item.summary || item.id || ""),
      accessRole: item.accessRole,
      primary: Boolean(item.primary),
      selected: item.selected !== false,
      hidden: Boolean(item.hidden),
      timeZone: item.timeZone || null,
    }));
}

/**
 * Read the authenticated user's primary calendar directly. The governed Staff
 * grant only needs this exact calendar; using CalendarList.get("primary")
 * avoids making a broad list operation a prerequisite for identity proof.
 * Failures expose only a bounded status/code, never Google's response body.
 */
export async function readPrimaryWritableGoogleCalendar(accessToken) {
  let response;
  try {
    response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch {
    throw exchangeFailure("Google primary calendar readback was unavailable", "calendar_readback_unavailable", "calendar_readback");
  }
  if (!response.ok) {
    const status = Number(response.status);
    const code = Number.isInteger(status) && status >= 400 && status <= 599
      ? `calendar_readback_http_${status}`
      : "calendar_readback_http_error";
    throw exchangeFailure("Google primary calendar readback failed", code, "calendar_readback", status || null);
  }
  let item;
  try {
    item = await response.json();
  } catch {
    throw exchangeFailure("Google primary calendar response was invalid", "calendar_readback_invalid_json", "calendar_readback");
  }
  const id = String(item?.id || "").trim();
  const accessRole = String(item?.accessRole || "").trim();
  if (!id || item?.deleted === true || item?.primary !== true) {
    throw exchangeFailure("Google primary calendar identity was incomplete", "calendar_readback_invalid_response", "calendar_readback");
  }
  if (!WRITABLE_CALENDAR_ROLES.has(accessRole)) {
    throw exchangeFailure("Google primary calendar is not writable", "primary_calendar_not_writable", "authority_readback");
  }
  return {
    id,
    summary: String(item.summary || id),
    accessRole,
    primary: true,
    selected: item.selected !== false,
    hidden: Boolean(item.hidden),
    timeZone: item.timeZone || null,
  };
}

export async function exchangeAndStoreStaffCalendarGrant(context, grant, code) {
  const identity = resolveStaffCalendarActor(grant?.actor);
  if (grant?.requiredPrimaryCalendarId !== identity.primaryCalendarId || !code) {
    throw exchangeFailure("invalid Staff calendar grant request", "grant_request_invalid", "request");
  }
  const client = staffCalendarOAuthClient(context.env, identity.actor);
  if (!client.clientId || !client.clientSecret) {
    throw exchangeFailure("Staff calendar OAuth client is not configured", "client_unconfigured", "configuration");
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.callbackUrl,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    throw exchangeFailure("Google token exchange was unavailable", "token_exchange_unavailable", "token_exchange");
  }
  if (!tokenResponse.ok) {
    throw exchangeFailure("Google token exchange failed", "token_exchange_failed", "token_exchange", tokenResponse.status);
  }
  const token = await tokenResponse.json();
  if (!token.access_token || !token.refresh_token) {
    throw exchangeFailure("Google did not return a durable calendar grant", "durable_grant_missing", "token_exchange");
  }
  const scopes = String(token.scope || "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(STAFF_CALENDAR_SCOPE)) {
    throw exchangeFailure("Google calendar scope was not granted", "calendar_scope_missing", "scope_readback");
  }

  let primary;
  try {
    primary = await readPrimaryWritableGoogleCalendar(token.access_token);
  } catch (error) {
    if (error?.code && error?.stage) throw error;
    throw exchangeFailure("Google Calendar writer readback failed", "calendar_readback_failed", "calendar_readback");
  }
  if (primary?.id.toLowerCase() !== identity.primaryCalendarId.toLowerCase()) {
    throw exchangeFailure("Google primary calendar does not match the governed Staff identity", "primary_calendar_mismatch", "identity_readback");
  }
  const calendars = [primary];

  const expiry = Date.now() + Number(token.expires_in || 3600) * 1000;
  const tokenKeys = ["access_token", "refresh_token", "token_expiry"].map((name) => staffCalendarKey(identity.actor, name));
  const statusKey = staffCalendarKey(identity.actor, "grant_status");
  await context.env.PORTAL_KV.delete(statusKey);
  try {
    await Promise.all([
      context.env.PORTAL_KV.put(tokenKeys[0], token.access_token),
      context.env.PORTAL_KV.put(tokenKeys[1], token.refresh_token),
      context.env.PORTAL_KV.put(tokenKeys[2], String(expiry)),
    ]);
    await context.env.PORTAL_KV.put(statusKey, JSON.stringify({
      actor: identity.actor,
      primaryCalendarId: primary.id,
      scopes,
      writableCalendarIds: calendars.map((calendar) => calendar.id),
      verifiedAt: new Date().toISOString(),
      bookingActivationEnabled: false,
      oauthCredentialFamily: client.credentialFamily,
    }));
  } catch (error) {
    await Promise.allSettled([...tokenKeys, statusKey].map((key) => context.env.PORTAL_KV.delete(key)));
    throw exchangeFailure("Calendar grant storage failed", "grant_storage_failed", "storage");
  }

  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    await context.env.PORTAL_KV.delete(`cos:cache:${identity.key}:${today}`);
  } catch (error) {
    console.error("[staff-calendar-oauth] failed to invalidate Calendar context cache", error);
  }
  return { identity, calendars };
}

export async function assertStaffCalendarAuthority(env, actor, calendarId) {
  const identity = resolveStaffCalendarActor(actor);
  const raw = await env?.PORTAL_KV?.get(staffCalendarKey(identity.actor, "grant_status"));
  let marker;
  try {
    marker = JSON.parse(raw);
  } catch {
    marker = null;
  }
  const writable = Array.isArray(marker?.writableCalendarIds) ? marker.writableCalendarIds : [];
  if (marker?.actor !== identity.actor
      || String(marker?.primaryCalendarId || "").toLowerCase() !== identity.primaryCalendarId.toLowerCase()
      || !Array.isArray(marker?.scopes)
      || !marker.scopes.includes(STAFF_CALENDAR_SCOPE)
      || !writable.includes(calendarId)
      || marker?.bookingActivationEnabled !== false) {
    const error = new Error("Google appointment calendar grant has not passed governed identity readback.");
    error.code = "calendar_provider_unavailable";
    throw error;
  }
  return marker;
}

export async function staffCalendarGrantReadiness(context, actor) {
  const identity = resolveStaffCalendarActor(actor);
  const oauthConfigured = staffCalendarOAuthConfigured(context.env, identity.actor);
  const provider = String(context.env.STAFF_APPOINTMENT_CALENDAR_PROVIDER || "ghl").trim();
  const configuredActor = String(context.env.STAFF_APPOINTMENT_GOOGLE_USER || "").trim();
  const configuredCalendarId = String(context.env.STAFF_APPOINTMENT_GOOGLE_CALENDAR_ID || "").trim();
  const activation = provider === "google_calendar" && configuredActor === identity.actor && Boolean(configuredCalendarId);
  if (!oauthConfigured) return {
    actor: identity.actor,
    requiredPrimaryCalendarId: identity.primaryCalendarId,
    oauthConfigured: false,
    connectionStatus: "unconfigured",
    grantPresent: false,
    grantVerified: false,
    calendars: [],
    bookingActivationEnabled: activation,
    blockers: ["Google Calendar authorization is not configured", "Staff booking remains on its current provider"],
  };

  const [access, refresh, marker, lastResultRaw] = await Promise.all([
    context.env.PORTAL_KV.get(staffCalendarKey(identity.actor, "access_token")),
    context.env.PORTAL_KV.get(staffCalendarKey(identity.actor, "refresh_token")),
    context.env.PORTAL_KV.get(staffCalendarKey(identity.actor, "grant_status")),
    context.env.PORTAL_KV.get(staffCalendarKey(identity.actor, "last_oauth_result")),
  ]);
  let lastOAuthResult = null;
  try {
    const parsed = JSON.parse(lastResultRaw);
    if (parsed?.actor === identity.actor && new Set(["connected", "failed"]).has(parsed?.status)) lastOAuthResult = parsed;
  } catch { lastOAuthResult = null; }
  const grantPresent = Boolean(access || refresh || marker);
  if (!grantPresent) return {
    actor: identity.actor,
    requiredPrimaryCalendarId: identity.primaryCalendarId,
    oauthConfigured: true,
    connectionStatus: "absent",
    grantPresent: false,
    grantVerified: false,
    lastOAuthResult,
    calendars: [],
    bookingActivationEnabled: activation,
    blockers: [`No verified Google Calendar grant is connected for ${identity.actor}`, "Staff booking remains on its current provider"],
  };

  try {
    const token = await getGoogleToken(context, identity.actor);
    const primary = await readPrimaryWritableGoogleCalendar(token);
    const calendars = [primary];
    const grantVerified = primary?.id.toLowerCase() === identity.primaryCalendarId.toLowerCase();
    let markerRecord = null;
    try { markerRecord = JSON.parse(marker); } catch { markerRecord = null; }
    const markerVerified = markerRecord?.actor === identity.actor
      && String(markerRecord?.primaryCalendarId || "").toLowerCase() === identity.primaryCalendarId.toLowerCase()
      && Array.isArray(markerRecord?.scopes)
      && markerRecord.scopes.includes(STAFF_CALENDAR_SCOPE)
      && Array.isArray(markerRecord?.writableCalendarIds);
    const configuredCalendarWritable = configuredCalendarId
      ? calendars.some((calendar) => calendar.id === configuredCalendarId)
      : false;
    return {
      actor: identity.actor,
      requiredPrimaryCalendarId: identity.primaryCalendarId,
      oauthConfigured: true,
      connectionStatus: grantVerified ? "verified" : "invalid",
      grantPresent: true,
      grantVerified,
      lastOAuthResult,
      authorityMarkerVerified: markerVerified,
      calendars,
      bookingActivationEnabled: activation && configuredCalendarWritable && markerVerified,
      blockers: [
        ...(!grantVerified ? [`The connected primary calendar is not ${identity.primaryCalendarId}`] : []),
        ...(grantVerified && !markerVerified ? ["Reconnect once to establish the governed calendar identity marker"] : []),
        ...(!activation ? ["Staff booking remains on its current provider"] : []),
        ...(activation && (!configuredCalendarWritable || !markerVerified) ? ["The configured appointment calendar has not passed governed writable readback"] : []),
      ],
    };
  } catch {
    return {
      actor: identity.actor,
      requiredPrimaryCalendarId: identity.primaryCalendarId,
      oauthConfigured: true,
      connectionStatus: "invalid",
      grantPresent: true,
      grantVerified: false,
      lastOAuthResult,
      calendars: [],
      bookingActivationEnabled: false,
      blockers: ["The stored Google Calendar grant could not be verified", "Staff booking remains on its current provider"],
    };
  }
}
