// Cloudflare Pages Function: GET /api/cos-google-callback
// Completes the one-time Google Calendar OAuth reconnect started by COS.

import {
  PERSONAL_CALENDAR_CALLBACK_URL,
  consumeStaffCalendarOAuthState,
  exchangeAndStoreStaffCalendarGrant,
  isStaffCalendarOAuthState,
  listWritableGoogleCalendars,
  recordStaffCalendarOAuthResult,
  resolveStaffCalendarActor,
  staffCalendarKey,
} from "../lib/staff-calendar-oauth.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SUCCESS_URL = "https://www.amarimethod.com/cos/?google=connected";
const FAILURE_URL = "https://www.amarimethod.com/cos/?google=failed";
const STAFF_SUCCESS_URL = "https://www.amarimethod.com/staff/operations?staffCalendar=connected";
const STAFF_FAILURE_URL = "https://www.amarimethod.com/staff/operations?staffCalendar=failed";

function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const stateKey = state ? `cos:google-oauth:${state}` : "";

  if (!stateKey || !context.env.PORTAL_KV) return redirect(FAILURE_URL);

  if (isStaffCalendarOAuthState(state)) {
    let staffGrant;
    try {
      staffGrant = await consumeStaffCalendarOAuthState(context.env, state);
    } catch {
      return redirect(STAFF_FAILURE_URL);
    }
    if (!code || url.searchParams.has("error")) {
      await recordStaffCalendarOAuthResult(context.env, staffGrant.actor, {
        status: "failed", stage: "authorization", code: "provider_denied",
      }).catch(() => {});
      return redirect(STAFF_FAILURE_URL);
    }
    try {
      await exchangeAndStoreStaffCalendarGrant(context, staffGrant, code);
      await recordStaffCalendarOAuthResult(context.env, staffGrant.actor, {
        status: "connected", stage: "complete", code: "grant_verified",
      }).catch(() => {});
      return redirect(STAFF_SUCCESS_URL);
    } catch (error) {
      await recordStaffCalendarOAuthResult(context.env, staffGrant.actor, {
        status: "failed", stage: error?.stage, code: error?.code,
      }).catch(() => {});
      return redirect(STAFF_FAILURE_URL);
    }
  }

  const saved = await context.env.PORTAL_KV.get(stateKey);
  // Always make state single-use, including when Google returned an error.
  await context.env.PORTAL_KV.delete(stateKey);
  if (!saved || !code || url.searchParams.has("error")) return redirect(FAILURE_URL);

  let grant;
  try {
    grant = JSON.parse(saved);
  } catch {
    return redirect(FAILURE_URL);
  }
  const actor = grant.user;
  let identity;
  try {
    identity = resolveStaffCalendarActor(actor);
  } catch {
    return redirect(FAILURE_URL);
  }
  if (identity.actor !== "Eben" || !context.env.GOOGLE_OAUTH_CLIENT_ID || !context.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return redirect(FAILURE_URL);
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: context.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: context.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: PERSONAL_CALENDAR_CALLBACK_URL,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    return redirect(FAILURE_URL);
  }
  if (!tokenResponse.ok) return redirect(FAILURE_URL);

  let token;
  try {
    token = await tokenResponse.json();
  } catch {
    return redirect(FAILURE_URL);
  }
  if (!token.access_token || !token.refresh_token) return redirect(FAILURE_URL);

  const scopes = String(token.scope || "").split(/\s+/).filter(Boolean);
  let calendars;
  try {
    calendars = await listWritableGoogleCalendars(token.access_token);
  } catch {
    return redirect(FAILURE_URL);
  }
  const primary = calendars.find((calendar) => calendar.primary);
  if (primary?.id.toLowerCase() !== identity.primaryCalendarId.toLowerCase()) {
    return redirect(FAILURE_URL);
  }

  const expiry = Date.now() + Number(token.expires_in || 3600) * 1000;
  const tokenKeys = ["access_token", "refresh_token", "token_expiry"].map((name) => staffCalendarKey(identity.actor, name));
  const statusKey = staffCalendarKey(identity.actor, "grant_status");
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
  }));

  // The chat endpoint caches its assembled Calendar context for five minutes.
  // Without clearing a pre-consent cache, the first post-reconnect answer can
  // still be told that Calendar is unavailable even though the new grant works.
  try {
    await context.env.PORTAL_KV.delete(`cos:cache:${identity.key}:${todayKey()}`);
  } catch (err) {
    console.error("[cos-google-callback] failed to invalidate Calendar context cache", err);
  }

  return redirect(SUCCESS_URL);
}
