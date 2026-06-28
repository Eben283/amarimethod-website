// Cloudflare Pages Function: GET /api/staff-outreach-cards
// Returns the latest OutreachCard[] snapshot stored in PORTAL_KV.
// Auth: same JWT pattern as other staff endpoints.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const KV_KEY = "outreach-snapshot:current";


export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), "GET, OPTIONS"),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, OPTIONS"), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;

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
