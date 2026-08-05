// GET /api/ops/incidents — service-authenticated open (or filtered) Amari Ops incidents.

import { corsHeaders } from "../../lib/endpoint-guards.js";
import { requireOpsReadKey } from "../../lib/ops-auth.js";
import { listOpsIncidents } from "../../lib/ops-events.js";

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin") || "", "GET, OPTIONS"),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = {
    ...corsHeaders(origin, "GET, OPTIONS"),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  const denied = requireOpsReadKey(context.request, context.env, headers);
  if (denied) return denied;

  const url = new URL(context.request.url);
  const status = url.searchParams.get("status") || "open";
  const pathId = url.searchParams.get("pathId") || undefined;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  try {
    const incidents = await listOpsIncidents(context.env, { status, pathId, limit });
    return new Response(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        configured: !!context.env.AUTOMATION_DB,
        incidents,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error(`[api/ops/incidents] ${err && err.message}`);
    return new Response(JSON.stringify({ error: "Failed to load incidents" }), {
      status: 500,
      headers,
    });
  }
}
