// Cloudflare Pages Function: POST /api/cos-daily-sync
// Receives the /day briefing from Claude Code and stores it in KV
// for the Chief of Staff phone app to read.

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

  // Service key auth only
  const serviceKey = context.request.headers.get("X-Service-Key");
  if (!serviceKey || serviceKey !== context.env.COS_SERVICE_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return jsonResponse({ error: "Storage not available" }, 500, origin);
  }

  const body = await context.request.json();
  const { date, briefing } = body;

  if (!date || !briefing) {
    return jsonResponse({ error: "date and briefing required" }, 400, origin);
  }

  // Store briefing with 7-day TTL
  await kv.put(`cos:daily-briefing:${date}`, briefing, {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  // Also store as "latest" for easy access
  await kv.put("cos:daily-briefing:latest", JSON.stringify({ date, briefing, synced: Date.now() }), {
    expirationTtl: 48 * 60 * 60,
  });

  return jsonResponse({ success: true, date }, 200, origin);
}
