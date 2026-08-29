import { getGoogleToken } from "./google-api.js";

export const PERSONAL_CALENDAR_CALLBACK_URL = "https://www.amarimethod.com/api/cos-google-callback";
export const AMARI_CALENDAR_CALLBACK_URL = "https://www.amarimethod.com/api/staff-amari-mail-callback";
export const STAFF_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const STAFF_CALENDAR_STATE_TTL_SECONDS = 10 * 60;

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
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createStaffCalendarOAuthState(env, actor, now = Date.now()) {
  const identity = resolveStaffCalendarActor(actor);
  const state = stateValue();
  await env.PORTAL_KV.put(
    `staff-calendar:oauth-state:${state}`,
    JSON.stringify({
      flow: "staff_appointment_calendar",
      actor: identity.actor,
      requiredPrimaryCalendarId: identity.primaryCalendarId,
      createdAt: now,
    }),
    { expirationTtl: STAFF_CALENDAR_STATE_TTL_SECONDS },
  );
  return state;
}

export async function consumeStaffCalendarOAuthState(env, state) {
  if (!/^[a-f0-9]{64}$/.test(String(state || ""))) return null;
  const key = `staff-calendar:oauth-state:${state}`;
  const saved = await env.PORTAL_KV.get(key);
  await env.PORTAL_KV.delete(key);
  if (!saved) return null;
  try {
    const grant = JSON.parse(saved);
    const identity = resolveStaffCalendarActor(grant.actor);
    if (grant.flow !== "staff_appointment_calendar" || grant.requiredPrimaryCalendarId !== identity.primaryCalendarId) return null;
    return grant;
  } catch {
    return null;
  }
}

export async function listWritableGoogleCalendars(accessToken) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250&showHidden=true", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Google Calendar ${response.status} readiness probe failed`);
  const body = await response.json();
  if (body?.nextPageToken) throw new Error("Google Calendar writer list exceeded the exact bounded page");
  return (body?.items || [])
    .filter((item) => !item.deleted && (item.accessRole === "owner" || item.accessRole === "writer"))
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

export async function exchangeAndStoreStaffCalendarGrant(context, grant, code) {
  const identity = resolveStaffCalendarActor(grant?.actor);
  if (grant?.requiredPrimaryCalendarId !== identity.primaryCalendarId || !code) {
    throw new Error("invalid Staff calendar grant request");
  }
  const client = staffCalendarOAuthClient(context.env, identity.actor);
  if (!client.clientId || !client.clientSecret) throw new Error("Staff calendar OAuth client is not configured");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
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
  if (!tokenResponse.ok) throw new Error(`Google token exchange failed: ${tokenResponse.status}`);
  const token = await tokenResponse.json();
  if (!token.access_token || !token.refresh_token) throw new Error("Google did not return a durable calendar grant");
  const scopes = String(token.scope || "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(STAFF_CALENDAR_SCOPE)) throw new Error("Google calendar scope was not granted");

  const calendars = await listWritableGoogleCalendars(token.access_token);
  const primary = calendars.find((calendar) => calendar.primary);
  if (primary?.id.toLowerCase() !== identity.primaryCalendarId.toLowerCase()) {
    throw new Error("Google primary calendar does not match the governed Staff identity");
  }

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
    throw error;
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

  const [access, refresh, marker] = await Promise.all([
    context.env.PORTAL_KV.get(staffCalendarKey(identity.actor, "access_token")),
    context.env.PORTAL_KV.get(staffCalendarKey(identity.actor, "refresh_token")),
    context.env.PORTAL_KV.get(staffCalendarKey(identity.actor, "grant_status")),
  ]);
  const grantPresent = Boolean(access || refresh || marker);
  if (!grantPresent) return {
    actor: identity.actor,
    requiredPrimaryCalendarId: identity.primaryCalendarId,
    oauthConfigured: true,
    connectionStatus: "absent",
    grantPresent: false,
    grantVerified: false,
    calendars: [],
    bookingActivationEnabled: activation,
    blockers: [`No verified Google Calendar grant is connected for ${identity.actor}`, "Staff booking remains on its current provider"],
  };

  try {
    const token = await getGoogleToken(context, identity.actor);
    const calendars = await listWritableGoogleCalendars(token);
    const primary = calendars.find((calendar) => calendar.primary);
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
      calendars: [],
      bookingActivationEnabled: false,
      blockers: ["The stored Google Calendar grant could not be verified", "Staff booking remains on its current provider"],
    };
  }
}
