// Cloudflare Pages Function: GET/POST /api/cos-actions
// Manages the action queue — read pending, update status

import { verifySessionToken } from "../lib/auth.js";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Service-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function authenticate(context) {
  // Service key auth for /inbox skill
  const serviceKey = context.request.headers.get("X-Service-Key");
  if (serviceKey && serviceKey === context.env.COS_SERVICE_KEY) {
    return { role: "service", user: "inbox" };
  }

  // JWT auth for the app
  const authHeader = context.request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;

  try {
    const payload = await verifySessionToken(token, context.env.JWT_SECRET);
    if (payload.role !== "cos") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

// GET /api/cos-actions?status=pending
export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";

  const auth = await authenticate(context);
  if (!auth) return jsonResponse({ error: "Unauthorized" }, 401, origin);

  const kv = context.env.PORTAL_KV;
  if (!kv) return jsonResponse({ actions: [] }, 200, origin);

  const url = new URL(context.request.url);
  const status = url.searchParams.get("status") || "pending";
  const user = url.searchParams.get("user") || auth.user || "Eben";

  const key = status === "completed" ? `cos:actions:${user}:completed` : `cos:actions:${user}:pending`;
  const raw = await kv.get(key);
  const actions = raw ? JSON.parse(raw) : [];

  return jsonResponse({ actions }, 200, origin);
}

// POST /api/cos-actions — update action status
// Body: { actionId, status: "completed"|"cancelled", result?: string }
export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";

  const auth = await authenticate(context);
  if (!auth) return jsonResponse({ error: "Unauthorized" }, 401, origin);

  const kv = context.env.PORTAL_KV;
  if (!kv) return jsonResponse({ error: "Storage not available" }, 500, origin);

  const body = await context.request.json();
  const { actionId, status, result } = body;

  if (!actionId || !status) {
    return jsonResponse({ error: "actionId and status required" }, 400, origin);
  }

  const user = body.user || auth.user || "Eben";

  const pendingRaw = await kv.get(`cos:actions:${user}:pending`);
  const pending = pendingRaw ? JSON.parse(pendingRaw) : [];

  const actionIndex = pending.findIndex(a => a.id === actionId);
  if (actionIndex === -1) {
    return jsonResponse({ error: "Action not found" }, 404, origin);
  }

  const action = { ...pending[actionIndex], status, completed_at: Date.now() };
  if (result) action.result = result;

  // Remove from pending
  const updatedPending = [...pending.slice(0, actionIndex), ...pending.slice(actionIndex + 1)];

  // Add to completed if completed
  const kvWrites = [kv.put(`cos:actions:${user}:pending`, JSON.stringify(updatedPending))];

  if (status === "completed" || status === "cancelled") {
    const completedRaw = await kv.get(`cos:actions:${user}:completed`);
    const completed = completedRaw ? JSON.parse(completedRaw) : [];
    kvWrites.push(kv.put(`cos:actions:${user}:completed`, JSON.stringify([...completed, action])));
  }

  await Promise.all(kvWrites);

  return jsonResponse({ success: true, action }, 200, origin);
}
