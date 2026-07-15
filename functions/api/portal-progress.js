// Cloudflare Pages Function: GET/POST /api/portal-progress
// Persists course progress in PORTAL_KV so clients don't lose state across devices.
//
// GET  — returns the stored progress object (or null if none)
// POST — writes a new progress object; client sends the full merged blob

import { requireOwner } from "../lib/owned-access.js";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin, methods = "GET, POST, OPTIONS") {
  const headers = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function kvKey(contactId) {
  return `lp_progress:${contactId}`;
}

// Routes through the shared ownership gate (lib/owned-access.js) so this
// endpoint enforces the same Bearer + verify + per-contact revoke checks as the
// rest of the portal. contactId comes from the verified JWT, never a request id.
// The short "Session expired" wording is preserved via a message override.
async function requirePortalAuth(context, headers) {
  const gate = await requireOwner(context, headers, {
    messages: { invalidToken: "Session expired", revoked: "Session expired" },
  });
  if (gate.error) return { error: gate.error };
  return { payload: gate.tokenPayload };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin") || ""),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  const { error, payload } = await requirePortalAuth(context, headers);
  if (error) return error;

  if (!context.env.PORTAL_KV) {
    return new Response(JSON.stringify({ progress: null }), { status: 200, headers });
  }

  const stored = await context.env.PORTAL_KV.get(kvKey(payload.contactId), "json").catch(() => null);
  return new Response(JSON.stringify({ progress: stored }), { status: 200, headers });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "POST, OPTIONS"), "Content-Type": "application/json" };

  const { error, payload } = await requirePortalAuth(context, headers);
  if (error) return error;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers });
  }

  if (!context.env.PORTAL_KV) {
    return new Response(JSON.stringify({ success: true, stored: false }), { status: 200, headers });
  }

  await context.env.PORTAL_KV.put(kvKey(payload.contactId), JSON.stringify(body));

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
