// Cloudflare Pages Function: GET /api/staff-outreach-cards
// Returns the latest OutreachCard[] snapshot stored in PORTAL_KV.
// Auth: same JWT pattern as other staff endpoints.

import { verifySessionToken } from "../lib/auth.js";

const KV_KEY = "outreach-snapshot:current";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers },
      );
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers,
      });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers,
      });
    }
    if (!tokenPayload || tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers,
      });
    }

    const kv = context.env.PORTAL_KV;
    if (!kv) {
      return new Response(JSON.stringify({ error: "KV not bound" }), {
        status: 500,
        headers,
      });
    }

    const raw = await kv.get(KV_KEY);
    if (!raw) {
      // No snapshot yet — return empty list, not an error. The Reach Out tab
      // will show a friendly "no snapshot yet" message.
      return new Response(
        JSON.stringify({ cards: [], generatedAt: null, uploadedAt: null, counts: { total: 0 } }),
        { status: 200, headers },
      );
    }

    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "Snapshot corrupted in KV" }), {
        status: 500,
        headers,
      });
    }

    return new Response(JSON.stringify(snapshot), { status: 200, headers });
  } catch (err) {
    console.error("[staff-outreach-cards]", err);
    return new Response(
      JSON.stringify({ error: err.message || "Failed to fetch outreach cards" }),
      { status: 500, headers },
    );
  }
}
