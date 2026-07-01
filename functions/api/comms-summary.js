// Cloudflare Pages Function: GET /api/comms-summary
// Returns the latest comms-coherence summary from KV (written by
// comms-coherence-worker's daily cron — see comms-coherence-worker/src/index.js).
// Used by the /day skill to surface cross-channel messaging flags without
// re-running the coherence check locally.

import { requireOpsReadKey } from "../lib/ops-auth.js";

const KV_SUMMARY = "comms:flags:summary";

export async function onRequestGet(context) {
  // PII gate — flags include client names + message content excerpts.
  // No CORS: the only consumer is the /day skill (server-to-server), not a browser.
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const headers = { "Content-Type": "application/json" };

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(
      JSON.stringify({ error: "KV not configured" }),
      { status: 500, headers }
    );
  }

  const data = await kv.get(KV_SUMMARY, "json");

  if (!data) {
    return new Response(
      JSON.stringify({ error: "No comms-coherence summary yet" }),
      { status: 404, headers }
    );
  }

  return new Response(JSON.stringify(data), { status: 200, headers });
}
