// POST /api/staff-coach-one
// Triggers the call-coach Worker's /coach-one endpoint for a single contact
// immediately (on-demand) rather than waiting for the nightly cron.
// Fire-and-forget: returns 202 right away; the worker runs in the background
// and writes coaching to KV when done (key: call-coach:latest:{contactId}).
//
// Called from FollowUpPage after a call outcome (talked / voicemail / no-answer)
// is logged via recordPartnerOutcome, so coaching is available within minutes
// for the next time Garrett opens that contact's card.
//
// Auth: JWT staff bearer at this layer + WORKER_AUTH_SECRET forwarded to the worker.

import { verifySessionToken } from "../lib/auth.js";

// Account subdomain confirmed 2026-05-25 (same as partner-activity-refresh worker).
const WORKER_URL = "https://call-coach.eben-fa2.workers.dev/coach-one";

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
    try {
      const tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
      if (tokenPayload.role !== "staff") {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Session expired. Please log in again." }),
        { status: 401, headers },
      );
    }

    const body = await context.request.json().catch(() => ({}));
    const { contactId } = body;
    if (!contactId || typeof contactId !== "string") {
      return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
    }

    // Kick off the worker and return immediately — same pattern as staff-refresh-activity.js.
    const workerHeaders = context.env.WORKER_AUTH_SECRET
      ? { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` }
      : {};
    const ac = new AbortController();
    const kickoff = fetch(`${WORKER_URL}?contactId=${encodeURIComponent(contactId)}`, {
      method: "GET",
      headers: workerHeaders,
      signal: ac.signal,
    }).catch((err) => {
      console.error("[staff-coach-one] worker kickoff error (expected on abort):", err.message);
    });
    setTimeout(() => ac.abort(), 1500);
    context.waitUntil(kickoff);

    return new Response(JSON.stringify({ triggered: true, contactId }), { status: 202, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-coach-one] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed: ${detail}` }),
      { status: 500, headers },
    );
  }
}
