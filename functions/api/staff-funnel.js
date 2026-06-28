// Cloudflare Pages Function: GET /api/staff-funnel
//
// Returns the latest cohort-funnel snapshot for the staff dashboard's Funnel tab.
//
// The funnel is computed OUT OF BAND by ~/.claude/ghl-mcp/funnel.mjs (run locally
// or on a schedule), which iterates ~250 GHL conversations + transactions — far
// beyond a Worker's subrequest budget — and publishes the result JSON to
// PORTAL_KV under `funnel:latest`. This endpoint just serves that cached snapshot,
// so the dashboard loads instantly.
//
// Publish step (local):
//   node ~/.claude/ghl-mcp/funnel.mjs 90
//   npx wrangler kv key put "funnel:latest" --namespace-id=79cff30d0e45419791b0d25cd81961df --path=/tmp/funnel-latest.json
//
// Auth: staff JWT bearer.


const KV_KEY = "funnel:latest";


export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const kv = context.env.PORTAL_KV;
    if (!kv) {
      return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers });
    }

    const snapshot = await kv.get(KV_KEY);
    if (!snapshot) {
      // No snapshot published yet — return an explicit empty shape so the UI can
      // show a "not generated yet" state instead of erroring.
      return new Response(
        JSON.stringify({ generatedAt: null, empty: true }),
        { status: 200, headers },
      );
    }

    // snapshot is already JSON text from funnel.mjs — pass it straight through.
    return new Response(snapshot, { status: 200, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-funnel] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to load funnel: ${detail}` }),
      { status: 500, headers },
    );
  }
}
