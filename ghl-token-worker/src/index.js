// GHL Token Auto-Refresh Worker
// Runs every 12 hours via cron trigger to keep OAuth tokens fresh in KV.

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";
const KV_LAST_RUN_KEY = "ops:ghl-token-refresh:lastRun";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshTokensAndRecord(env));
  },

  // Allow manual trigger via HTTP for testing: curl http://localhost:8787
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__scheduled" || url.pathname === "/") {
      const result = await refreshTokensAndRecord(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/status") {
      const raw = await env.PORTAL_KV?.get(KV_LAST_RUN_KEY);
      return new Response(raw || JSON.stringify({ error: "no lastRun recorded" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};

// Wrapper that always writes a lastRun summary to KV — even when refresh
// fails. Without this, the daily-audit watchdog couldn't tell "worker
// never ran" from "worker ran and failed." See checkTokenRefresh() in
// daily-audit-worker/src/index.js.
async function refreshTokensAndRecord(env) {
  let result;
  try {
    result = await refreshTokens(env);
  } catch (err) {
    result = { success: false, error: `unhandled: ${err.message}` };
  }
  try {
    const summary = {
      ...result,
      finishedAt: new Date().toISOString(),
      status: result.success ? "ok" : "error",
    };
    if (env.PORTAL_KV) {
      await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    }
  } catch (err) {
    console.error(`[token-refresh] Failed to write lastRun: ${err.message}`);
  }
  return result;
}

async function refreshTokens(env) {
  const { PORTAL_KV: kv, GHL_CLIENT_ID: clientId, GHL_CLIENT_SECRET: clientSecret } = env;

  if (!kv) {
    console.error("[token-refresh] PORTAL_KV binding not available");
    return { success: false, error: "PORTAL_KV binding not available" };
  }

  if (!clientId || !clientSecret) {
    console.error("[token-refresh] Missing GHL_CLIENT_ID or GHL_CLIENT_SECRET");
    return { success: false, error: "Missing GHL_CLIENT_ID or GHL_CLIENT_SECRET" };
  }

  const refreshToken = await kv.get(KV_REFRESH_TOKEN);
  if (!refreshToken) {
    console.error("[token-refresh] No refresh token found in KV");
    return { success: false, error: "No refresh token in KV" };
  }

  // Check if token actually needs refreshing (skip if >6 hours remaining)
  const expiryStr = await kv.get(KV_TOKEN_EXPIRY);
  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  const now = Date.now();
  const sixHoursMs = 6 * 60 * 60 * 1000;

  if (expiry > now + sixHoursMs) {
    const hoursLeft = ((expiry - now) / (60 * 60 * 1000)).toFixed(1);
    console.log(`[token-refresh] Token still valid for ${hoursLeft}h — skipping refresh`);
    return { success: true, skipped: true, hoursRemaining: parseFloat(hoursLeft) };
  }

  try {
    const response = await fetch(GHL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[token-refresh] GHL API error: ${response.status} ${errText}`);
      return { success: false, error: `GHL API ${response.status}`, detail: errText };
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token;
    const expiresIn = data.expires_in || 86399;

    if (!newAccessToken) {
      console.error("[token-refresh] No access_token in response");
      return { success: false, error: "No access_token in response" };
    }

    const newExpiry = Date.now() + expiresIn * 1000;

    await Promise.all([
      kv.put(KV_ACCESS_TOKEN, newAccessToken),
      kv.put(KV_REFRESH_TOKEN, newRefreshToken || refreshToken),
      kv.put(KV_TOKEN_EXPIRY, String(newExpiry)),
    ]);

    const hoursUntilExpiry = (expiresIn / 3600).toFixed(1);
    console.log(`[token-refresh] Success — new token expires in ${hoursUntilExpiry}h`);

    return {
      success: true,
      expiresInHours: parseFloat(hoursUntilExpiry),
      refreshedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[token-refresh] Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}
