// Staff-owned Amari mail authorization. GET reports the non-delivering grant
// readiness; POST starts a one-time Google consent flow for the signed, known
// Staff actor's own mailbox. The request cannot select another actor or sender.

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";
import {
  AMARI_MAIL_CALLBACK_URL,
  AMARI_MAIL_SCOPES,
  amariMailGrantReadiness,
  amariMailOAuthConfigured,
  createAmariMailOAuthState,
  resolveAmariMailbox,
} from "../lib/amari-mail-oauth.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const ALLOWED_ORIGINS = new Set(["https://www.amarimethod.com", "https://amarimethod.com"]);

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS") });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  try {
    return json(await amariMailGrantReadiness(context.env, payload?.user), 200, headers);
  } catch {
    return json({ error: "Staff mailbox is not authorized" }, 403, headers);
  }
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Untrusted origin" }, 403, headers);
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  try {
    resolveAmariMailbox(payload?.user);
  } catch {
    return json({ error: "Staff mailbox is not authorized" }, 403, headers);
  }
  if (!amariMailOAuthConfigured(context.env)) return json({ error: "Amari mail authorization is not configured" }, 503, headers);

  const state = await createAmariMailOAuthState(context.env, payload.user);
  const authorizationUrl = new URL(AUTH_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: context.env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: AMARI_MAIL_CALLBACK_URL,
    response_type: "code",
    scope: AMARI_MAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return json({ authorizationUrl: authorizationUrl.toString(), deliveryEnabled: false }, 200, headers);
}
