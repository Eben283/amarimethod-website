// Staff-owned practitioner-calendar authorization and read-only readiness.
// Connecting a grant does not select a provider or activate booking writes.

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";
import {
  STAFF_CALENDAR_CALLBACK_URL,
  STAFF_CALENDAR_SCOPE,
  createStaffCalendarOAuthState,
  resolveStaffCalendarActor,
  staffCalendarGrantReadiness,
  staffCalendarOAuthConfigured,
} from "../lib/staff-calendar-oauth.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const ALLOWED_ORIGINS = new Set(["https://www.amarimethod.com", "https://amarimethod.com"]);

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS") });
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin") || "", "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  try {
    resolveStaffCalendarActor(payload?.user);
    return json(await staffCalendarGrantReadiness(context, payload.user), 200, headers);
  } catch {
    return json({ error: "Staff calendar identity is not authorized" }, 403, headers);
  }
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Untrusted origin" }, 403, headers);
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  let identity;
  try {
    identity = resolveStaffCalendarActor(payload?.user);
  } catch {
    return json({ error: "Staff calendar identity is not authorized" }, 403, headers);
  }
  if (!staffCalendarOAuthConfigured(context.env)) return json({ error: "Google Calendar authorization is not configured" }, 500, headers);

  const state = await createStaffCalendarOAuthState(context.env, identity.actor);
  const authorizationUrl = new URL(AUTH_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: context.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: STAFF_CALENDAR_CALLBACK_URL,
    response_type: "code",
    scope: STAFF_CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return json({ actor: identity.actor, requiredPrimaryCalendarId: identity.primaryCalendarId, authorizationUrl: authorizationUrl.toString(), bookingActivationEnabled: false }, 200, headers);
}
