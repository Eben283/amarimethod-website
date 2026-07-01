// POST /api/staff-funnel-refresh
// Triggers the funnel-refresh Worker on-demand and waits for it to finish.
//
// Unlike staff-refresh-activity.js (which kicks off a 10-15 min partner job and
// returns immediately), the funnel worker's /refresh runs the whole pull INLINE
// and returns its summary in ~45s. So this proxy AWAITS the worker and passes the
// summary straight back — the staff frontend shows "refreshing…" and then polls
// getFunnel() until generatedAt advances.
//
// Auth: staff JWT bearer at THIS layer; the funnel worker's own HTTP gate
// (requireWorkerAuth) is satisfied by forwarding WORKER_AUTH_SECRET as a Bearer
// token. Both must be set: the Pages env var + the worker secret (same value).

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const WORKER_URL = "https://funnel-refresh.eben-fa2.workers.dev/refresh";

// The worker pull is ~40-45s of wall time. Give the proxy fetch a generous
// ceiling above that so a slow GHL day doesn't truncate the run.
const WORKER_TIMEOUT_MS = 90_000;


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
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), WORKER_TIMEOUT_MS);
    const workerHeaders = context.env.WORKER_AUTH_SECRET
      ? { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` }
      : undefined;

    let summary;
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: workerHeaders,
        signal: ac.signal,
      });
      summary = await res.json().catch(() => ({ status: "unknown" }));
      if (!res.ok) {
        return new Response(
          JSON.stringify({ triggered: false, error: `Worker returned ${res.status}`, summary }),
          { status: 422, headers },
        );
      }
    } catch (err) {
      const aborted = err && err.name === "AbortError";
      const detail = aborted ? "Refresh timed out (worker still running)" : (err.message || String(err));
      console.error("[staff-funnel-refresh] worker fetch error:", detail);
      // On timeout the worker keeps running; the frontend will still see the new
      // snapshot once it lands, so report a soft failure rather than a hard error.
      return new Response(
        JSON.stringify({ triggered: aborted, error: detail }),
        { status: aborted ? 202 : 422, headers },
      );
    } finally {
      clearTimeout(timer);
    }

    return new Response(
      JSON.stringify({ triggered: true, summary }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-funnel-refresh] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to trigger funnel refresh: ${detail}` }),
      { status: 500, headers },
    );
  }
}
