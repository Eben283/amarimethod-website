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


// Account subdomain confirmed 2026-05-25 (same as partner-activity-refresh worker).
const WORKER_URL = "https://call-coach.eben-fa2.workers.dev/coach-one";


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
