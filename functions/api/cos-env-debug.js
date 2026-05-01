// Debug endpoint: GET /api/cos-env-debug?key=<COS_SERVICE_KEY>
// Reports which env vars and bindings are present (NOT their values).
// Used to diagnose preview vs production environment differences.

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const key = url.searchParams.get("key");
  if (!key || key !== context.env.COS_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const expectedVars = [
    "JWT_SECRET", "COS_PIN_EBEN", "COS_PIN_GARRETT", "COS_SERVICE_KEY",
    "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
    "GHL_API_KEY", "GHL_CLIENT_ID", "GHL_CLIENT_SECRET", "GHL_OAUTH_SETUP_SECRET", "GHL_WEBHOOK_SECRET",
    "STRIPE_SECRET_KEY",
    "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
  ];
  const envStatus = {};
  for (const v of expectedVars) {
    envStatus[v] = !!context.env[v] ? "set" : "MISSING";
  }

  const expectedBindings = ["PORTAL_KV", "PURCHASE_KV"];
  const bindingStatus = {};
  for (const b of expectedBindings) {
    bindingStatus[b] = !!context.env[b] ? "bound" : "MISSING";
  }

  // Quick GHL probe — does ghl_token_expiry exist in KV?
  let kvProbe = "skipped";
  if (context.env.PORTAL_KV) {
    try {
      const expiry = await context.env.PORTAL_KV.get("ghl_token_expiry");
      const access = await context.env.PORTAL_KV.get("ghl_access_token");
      kvProbe = {
        ghl_token_expiry: expiry ? `set (${new Date(parseInt(expiry, 10)).toISOString()})` : "MISSING",
        ghl_access_token: access ? `set (length ${access.length})` : "MISSING",
      };
    } catch (err) {
      kvProbe = `error: ${err.message}`;
    }
  }

  return new Response(JSON.stringify({
    env_vars: envStatus,
    bindings: bindingStatus,
    kv_probe: kvProbe,
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
