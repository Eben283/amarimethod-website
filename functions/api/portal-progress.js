// Cloudflare Pages Function: GET/POST /api/portal-progress
// Persists course progress in PORTAL_KV so clients don't lose state across devices.
//
// GET  — returns the stored progress object (or null if none)
// POST — writes a new progress object; client sends the full merged blob

import { verifySessionToken } from "../lib/auth.js";
import { isContactRevoked } from "../lib/session-guard.js";

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

async function requirePortalAuth(context, headers) {
  const secret = context.env.JWT_SECRET;
  if (!secret) {
    return { error: new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers }) };
  }

  const auth = context.request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return { error: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers }) };
  }

  let payload;
  try {
    payload = await verifySessionToken(auth.slice(7), secret);
  } catch {
    return { error: new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers }) };
  }

  if (!payload.contactId) {
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers }) };
  }

  // Per-contact kill switch (2026-07-02 audit — same check as portal-data).
  if (await isContactRevoked(context.env.PORTAL_KV, payload.contactId)) {
    return { error: new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers }) };
  }

  return { payload };
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
