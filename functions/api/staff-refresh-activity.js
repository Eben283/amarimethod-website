// POST /api/staff-refresh-activity
// Triggers the partner-activity-refresh Worker on-demand.
// Returns the worker's run summary so the staff app can show what happened.
//
// Auth: JWT bearer (same pattern as other staff endpoints) at THIS layer, plus
// the partner-activity worker's own HTTP gate (requireWorkerAuth). We forward
// WORKER_AUTH_SECRET as a Bearer token on the kickoff fetch; until that secret
// is set in both the Pages env and the worker env, the worker gate is a no-op
// and the missing header is harmless (CRIT-A rollout, 2026-06-11).

import { verifySessionToken } from "../lib/auth.js";

// Worker subdomain confirmed after first deploy 2026-05-25 — Eben's Cloudflare
// account uses `eben-fa2` as the workers.dev subdomain, not `amari-method`.
const WORKER_URL = "https://partner-activity-refresh.eben-fa2.workers.dev/run";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function onRequestPost(context) {
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

    // The worker takes ~10-15 minutes to run all ~412 contacts. The user-facing
    // CTA shouldn't wait that long, so we kick it off and return immediately —
    // the worker writes its summary to KV when done, picked up by the next
    // prospects fetch. Worker's /run endpoint also writes the summary on completion.
    //
    // We use fetch() with a low-timeout AbortController so the kick-off doesn't
    // block the response. CF Workers run independently once spawned.
    const ac = new AbortController();
    const workerHeaders = context.env.WORKER_AUTH_SECRET
      ? { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` }
      : undefined;
    const kickoff = fetch(WORKER_URL, {
      method: "GET",
      headers: workerHeaders,
      signal: ac.signal,
    }).catch((err) => {
      console.error("[staff-refresh-activity] worker kickoff fetch error (expected on abort):", err.message);
    });
    // Don't actually wait for the worker — abort the read after 1.5s so we
    // return fast. The worker keeps running on Cloudflare's side regardless.
    setTimeout(() => ac.abort(), 1500);
    // Park the promise — silenced
    context.waitUntil(kickoff);

    return new Response(
      JSON.stringify({
        triggered: true,
        message: "Refresh triggered. Re-load the page in 5-15 minutes to see updated activity dates.",
      }),
      { status: 202, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-refresh-activity] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to trigger refresh: ${detail}` }),
      { status: 500, headers },
    );
  }
}
