// Cloudflare Pages Function: GET /api/staff-funnel
//
// Returns the latest cohort-funnel snapshot for the staff dashboard's Funnel tab.
//
// The funnel is computed OUT OF BAND by ~/.claude/ghl-mcp/funnel.mjs (run locally
// or on a schedule), which iterates ~250 GHL conversations + transactions — far
// beyond a Worker's subrequest budget — and publishes the result JSON to
// PORTAL_KV under `funnel:latest`. This endpoint just serves that cached snapshot,
// so the dashboard loads instantly.
//
// Publish step (local):
//   node ~/.claude/ghl-mcp/funnel.mjs 90
//   npx wrangler kv key put "funnel:latest" --namespace-id=79cff30d0e45419791b0d25cd81961df --path=/tmp/funnel-latest.json
//
// Auth: staff JWT bearer.

import { verifySessionToken } from "../lib/auth.js";

const KV_KEY = "funnel:latest";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
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
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }
    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401, headers });
    }
    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const kv = context.env.PORTAL_KV;
    if (!kv) {
      return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers });
    }

    const snapshot = await kv.get(KV_KEY);
    if (!snapshot) {
      // No snapshot published yet — return an explicit empty shape so the UI can
      // show a "not generated yet" state instead of erroring.
      return new Response(
        JSON.stringify({ generatedAt: null, empty: true }),
        { status: 200, headers },
      );
    }

    // snapshot is already JSON text from funnel.mjs — pass it straight through.
    return new Response(snapshot, { status: 200, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-funnel] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to load funnel: ${detail}` }),
      { status: 500, headers },
    );
  }
}
