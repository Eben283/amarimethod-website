// Cloudflare Pages Function: GET /api/cos-parking-current
// Read-only home-screen snapshot for COS. It intentionally never calls chat,
// an LLM, or City data; those costs belong to recording a new parking spot.

import { verifySessionToken } from "../lib/auth.js";
import { getCurrentParkingSnapshot } from "../lib/cos-parking.js";

const ALLOWED_ORIGINS = ["https://www.amarimethod.com", "https://amarimethod.com"];

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function authenticate(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  try {
    const payload = await verifySessionToken(token, env.JWT_SECRET);
    return payload.role === "cos" && payload.user ? payload : null;
  } catch {
    return null;
  }
}

export function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin") || ""),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const auth = await authenticate(context.request, context.env);
  if (!auth) return jsonResponse({ error: "Unauthorized" }, 401, origin);
  if (!context.env.PORTAL_KV) return jsonResponse({ error: "Storage not available" }, 500, origin);

  try {
    const parking = await getCurrentParkingSnapshot(context.env, auth.user);
    return jsonResponse({ parking }, 200, origin);
  } catch (error) {
    console.error("[cos-parking-current] read error:", error.message);
    return jsonResponse({ error: "Could not load parking" }, 500, origin);
  }
}
