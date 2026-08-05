// Cloudflare Pages Function: POST /api/cos-google-auth
// Starts an authenticated, one-time Google Workspace OAuth reconnect for COS.
// The same Eben-owned grant supplies Calendar and the future Client Desk Gmail
// sender; it is never a customer-facing authorization flow.

import { verifySessionToken } from "../lib/auth.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALLBACK_URL = "https://www.amarimethod.com/api/cos-google-callback";
const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
].join(" ");
const STATE_TTL_SECONDS = 10 * 60;
const ALLOWED_ORIGINS = new Set(["https://www.amarimethod.com", "https://amarimethod.com"]);

function cors(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function stateValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: cors(context.request.headers.get("Origin") || "") });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const token = context.request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!token || !context.env.JWT_SECRET) return response({ error: "Unauthorized" }, 401, origin);

  let session;
  try {
    session = await verifySessionToken(token, context.env.JWT_SECRET);
  } catch {
    return response({ error: "Session expired. Please sign in again." }, 401, origin);
  }

  if (session.role !== "cos" || session.user !== "Eben" || !context.env.PORTAL_KV) {
    return response({ error: "Unauthorized" }, 401, origin);
  }
  if (!context.env.GOOGLE_OAUTH_CLIENT_ID || !context.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return response({ error: "Google Calendar is not configured." }, 500, origin);
  }

  const state = stateValue();
  await context.env.PORTAL_KV.put(
    `cos:google-oauth:${state}`,
    JSON.stringify({ user: "Eben", createdAt: Date.now() }),
    { expirationTtl: STATE_TTL_SECONDS },
  );

  const authorizationUrl = new URL(AUTH_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: context.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    response_type: "code",
    scope: GOOGLE_WORKSPACE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();

  return response({ authorizationUrl: authorizationUrl.toString() }, 200, origin);
}
