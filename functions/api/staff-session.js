// Staff session cookie bridge. It keeps the Staff JWT out of JavaScript after
// login while allowing existing valid localStorage sessions to upgrade once.

import { corsHeaders, requireStaffAuth, STAFF_SESSION_COOKIE } from "../lib/endpoint-guards.js";

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const sessionCookie = (value, maxAge = MAX_AGE_SECONDS) => `${STAFF_SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
const responseHeaders = (origin, cookie) => ({ ...corsHeaders(origin, "GET, POST, DELETE, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": cookie });
const bearerToken = request => request.headers.get("Authorization")?.startsWith("Bearer ") ? request.headers.get("Authorization").slice(7) : null;

async function authenticatedResponse(context) {
  const headers = responseHeaders(context.request.headers.get("Origin"), "");
  const { error, payload } = await requireStaffAuth(context, headers);
  return error || { payload, headers };
}

export async function onRequestOptions(context) { return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, POST, DELETE, OPTIONS") }); }
export async function onRequestGet(context) {
  const result = await authenticatedResponse(context);
  if (result instanceof Response) return result;
  return new Response(JSON.stringify({ authenticated: true, user: result.payload.user }), { status: 200, headers: result.headers });
}
export async function onRequestPost(context) {
  const result = await authenticatedResponse(context);
  if (result instanceof Response) return result;
  const token = bearerToken(context.request);
  const cookieValue = token || context.request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${STAFF_SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!cookieValue) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: result.headers });
  return new Response(JSON.stringify({ authenticated: true, user: result.payload.user }), { status: 200, headers: responseHeaders(context.request.headers.get("Origin"), sessionCookie(cookieValue)) });
}
export async function onRequestDelete(context) {
  return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: responseHeaders(context.request.headers.get("Origin"), sessionCookie("", 0)) });
}
