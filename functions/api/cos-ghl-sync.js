// Cloudflare Pages Function: POST /api/cos-ghl-sync
// Receives GHL workflow knowledge from Claude Code and stores in KV
// for the Chief of Staff phone app to read on-demand.

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Service-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";

  const serviceKey = context.request.headers.get("X-Service-Key");
  if (!serviceKey || serviceKey !== context.env.COS_SERVICE_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return jsonResponse({ error: "Storage not available" }, 500, origin);
  }

  const body = await context.request.json();
  const { workflows, issues, pendingFixes } = body;

  if (!workflows) {
    return jsonResponse({ error: "workflows field is required" }, 400, origin);
  }

  const payload = JSON.stringify({
    workflows,
    issues: issues || null,
    pendingFixes: pendingFixes || null,
    synced: Date.now(),
  });

  // 30-day TTL — workflows change infrequently, /day refreshes daily
  await kv.put("cos:ghl:knowledge", payload, {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  return jsonResponse({
    success: true,
    size: payload.length,
    hasIssues: !!issues,
    hasPendingFixes: !!pendingFixes,
  }, 200, origin);
}
