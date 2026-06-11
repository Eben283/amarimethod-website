// Cloudflare Pages Function: GET /api/ecosystem-scan
// Returns cached ecosystem scan results from KV (written by ecosystem-scanner cron).
// Used by the /day skill to read pre-computed scan data.
//
// Query params:
//   ?date=YYYY-MM-DD  (optional, defaults to today Pacific Time)

import { requireOpsReadKey } from "../lib/ops-auth.js";

const PT = "America/Los_Angeles";
const SCAN_KV_PREFIX = "ops:ecosystem-scan:";

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(new Date());
}

export async function onRequestGet(context) {
  // Gated for parity with /api/daily-audit (shares the ops read key). Only consumer
  // is the /day skill (server-to-server), so no CORS header is needed.
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const headers = {
    "Content-Type": "application/json",
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

  const data = await kv.get(`${SCAN_KV_PREFIX}${date}`, "json");

  if (!data) {
    return new Response(
      JSON.stringify({ error: "No scan data for this date", date }),
      { status: 404, headers }
    );
  }

  return new Response(JSON.stringify(data), { status: 200, headers });
}
