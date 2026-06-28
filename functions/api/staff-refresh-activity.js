// POST /api/staff-refresh-activity
// Triggers the partner-activity-refresh Worker on-demand.
// Returns the worker's run summary so the staff app can show what happened.
//
// Auth: JWT bearer (same pattern as other staff endpoints) at THIS layer, plus
// the partner-activity worker's own HTTP gate (requireWorkerAuth). We forward
// WORKER_AUTH_SECRET as a Bearer token on the kickoff fetch; until that secret
// is set in both the Pages env and the worker env, the worker gate is a no-op
// and the missing header is harmless (CRIT-A rollout, 2026-06-11).


// Worker subdomain confirmed after first deploy 2026-05-25 — Eben's Cloudflare
// account uses `eben-fa2` as the workers.dev subdomain, not `amari-method`.
const WORKER_URL = "https://partner-activity-refresh.eben-fa2.workers.dev/run";


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
