// Debug endpoint: GET /api/cos-vault-debug?key=<COS_SERVICE_KEY>
// Returns the doc names + sizes currently in cos:vault:knowledge.
// Read-only, service-key gated. Safe to leave deployed.

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const key = url.searchParams.get("key");
  if (!key || key !== context.env.COS_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: "KV not bound" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const raw = await kv.get("cos:vault:knowledge");
  if (!raw) {
    return new Response(JSON.stringify({ error: "cos:vault:knowledge not found in KV" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return new Response(JSON.stringify({ error: "stored value is not JSON", rawLength: raw.length }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const docInfo = {};
  for (const [name, content] of Object.entries(parsed.docs || {})) {
    docInfo[name] = {
      bytes: content.length,
      preview: content.slice(0, 120).replace(/\s+/g, " "),
    };
  }

  return new Response(JSON.stringify({
    synced: parsed.synced ? new Date(parsed.synced).toISOString() : null,
    docCount: Object.keys(parsed.docs || {}).length,
    totalBytes: raw.length,
    docs: docInfo,
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
