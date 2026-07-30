// POST /api/staff-call-coach-run
// Triggers a full call-coach day sweep on demand (Whisper + OpenRouter).
// Fire-and-forget 202 — coaching is expensive; do not auto-cron it.
//
// Body (optional): { "date": "YYYY-MM-DD" } — Pacific date; defaults to yesterday.
//
// Auth: staff JWT here; WORKER_AUTH_SECRET forwarded to call-coach /run.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const WORKER_BASE = "https://call-coach.eben-fa2.workers.dev";

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
    const { error } = await requireStaffAuth(context, headers);
    if (error) return error;

    const body = await context.request.json().catch(() => ({}));
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : null;

    const workerHeaders = context.env.WORKER_AUTH_SECRET
      ? { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` }
      : {};
    const runUrl = date
      ? `${WORKER_BASE}/run?date=${encodeURIComponent(date)}`
      : `${WORKER_BASE}/run`;

    const ac = new AbortController();
    const kickoff = fetch(runUrl, {
      method: "GET",
      headers: workerHeaders,
      signal: ac.signal,
    }).catch((err) => {
      console.error("[staff-call-coach-run] worker kickoff error (expected on abort):", err.message);
    });
    setTimeout(() => ac.abort(), 1500);
    context.waitUntil(kickoff);

    return new Response(
      JSON.stringify({
        triggered: true,
        date: date || "yesterday-pacific",
        message: "Call coach day sweep started — check call-coach:status:lastRun in KV / worker /status.",
      }),
      { status: 202, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-call-coach-run] failed:", detail);
    return new Response(JSON.stringify({ error: `Failed: ${detail}` }), { status: 500, headers });
  }
}
