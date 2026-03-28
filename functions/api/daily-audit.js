// Cloudflare Pages Function: GET /api/daily-audit
// Returns cached daily audit results from KV (written by daily-audit-worker cron).
// Used by the /day skill to read pre-computed audit data instead of running locally.
//
// Query params:
//   ?date=YYYY-MM-DD  (optional, defaults to today Pacific Time)

const PT = "America/Los_Angeles";
const AUDIT_KV_PREFIX = "ops:daily-audit:";

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(new Date());
}

export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(
      JSON.stringify({ error: "KV not configured" }),
      { status: 500, headers }
    );
  }

  const url = new URL(context.request.url);
  const date = url.searchParams.get("date") || todayPacific();

  const data = await kv.get(`${AUDIT_KV_PREFIX}${date}`, "json");

  if (!data) {
    return new Response(
      JSON.stringify({ error: "No audit data for this date", date }),
      { status: 404, headers }
    );
  }

  return new Response(JSON.stringify(data), { status: 200, headers });
}
