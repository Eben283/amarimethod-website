// Cloudflare Pages Function: POST /api/cos-vault-sync
// Receives a bundle of Obsidian vault docs from a local sync script and
// stores them in KV so the Chief of Staff phone app can ground answers
// in Eben's accumulated thinking (positioning, brand voice, lifecycles, etc.)

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
  const { docs } = body;

  if (!docs || typeof docs !== "object" || Array.isArray(docs)) {
    return jsonResponse({ error: "docs must be an object: { name: content }" }, 400, origin);
  }

  const payload = JSON.stringify({
    docs,
    synced: Date.now(),
    docCount: Object.keys(docs).length,
  });

  // 30-day TTL — sync runs daily via /day skill; TTL is just a safety net
  await kv.put("cos:vault:knowledge", payload, {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  return jsonResponse({
    success: true,
    size: payload.length,
    docCount: Object.keys(docs).length,
    docNames: Object.keys(docs),
  }, 200, origin);
}
