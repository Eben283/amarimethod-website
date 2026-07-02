// GHL Token Auto-Refresh Worker
// Runs every 12 hours via cron trigger to keep OAuth tokens fresh in KV.

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";
const KV_LAST_RUN_KEY = "ops:ghl-token-refresh:lastRun";
// Latched (NOT overwritten by later runs) token-lost marker. lastRun is
// rewritten every cron, so a token-lost event followed by a routine failed
// attempt would downgrade back to a generic error before the daily audit
// reads it. This key persists until a refresh SUCCEEDS (which proves the
// stored token chain is healthy again).
const KV_TOKEN_LOST_KEY = "ops:ghl-token-refresh:tokenLost";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshTokensAndRecord(env));
  },

  // Allow manual trigger via HTTP for testing: curl http://localhost:8787
  async fetch(request, env) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

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

  // Skip only when more than 13h remain. The threshold must exceed the 12h
  // cron interval: GHL tokens live ~24h, so with the old 6h threshold the
  // 12h-mark run always saw 12h remaining and skipped, pushing every real
  // refresh to the ~0h mark — i.e. the token was refreshed already-expired,
  // at exactly 00:00 UTC when three other workers' crons fire and race the
  // single-use refresh token. At 13h, every 12h run refreshes with ~12h of
  // margin and consumers essentially never need on-demand refresh.
  const expiryStr = await kv.get(KV_TOKEN_EXPIRY);
  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  const now = Date.now();
  const skipThresholdMs = 13 * 60 * 60 * 1000;

  if (expiry > now + skipThresholdMs) {
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

    // The old refresh token died the moment GHL responded — if these puts
    // fail, the new one is orphaned and auth is unrecoverable without a
    // manual re-auth. Retry each put, and on final failure report a DISTINCT
    // token-lost status so the daily-audit watchdog can tell "harmless
    // failed attempt" from "rotation succeeded but the result was lost".
    const putWithRetry = async (key, value, attempts = 3) => {
      let lastErr;
      for (let i = 0; i < attempts; i++) {
        try {
          await kv.put(key, value);
          return true;
        } catch (err) {
          lastErr = err;
          if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        }
      }
      console.error(`[token-refresh] KV put failed after ${attempts} attempts (${key}): ${lastErr?.message}`);
      return false;
    };
    // Sequential, expiry LAST: a fresh expiry over a stale access token
    // would make consumers treat the dead token as valid for ~12h.
    const okAccess = await putWithRetry(KV_ACCESS_TOKEN, newAccessToken);
    const okRefresh = await putWithRetry(KV_REFRESH_TOKEN, newRefreshToken || refreshToken);
    const okExpiry =
      okAccess && okRefresh ? await putWithRetry(KV_TOKEN_EXPIRY, String(newExpiry)) : false;
    if (!okAccess || !okRefresh || !okExpiry) {
      console.error("[token-refresh] CRITICAL: rotation succeeded at GHL but KV persist failed — stored refresh token may be dead");
      // Latch the event (best-effort — KV is already misbehaving here, but a
      // partial outage may still let this small put through).
      try {
        await kv.put(KV_TOKEN_LOST_KEY, JSON.stringify({
          at: new Date().toISOString(),
          detail: `persist results access=${okAccess} refresh=${okRefresh} expiry=${okExpiry}`,
        }));
      } catch (latchErr) {
        console.error(`[token-refresh] token-lost latch write also failed: ${latchErr.message}`);
      }
      return {
        success: false,
        tokenLost: true,
        error: "CRITICAL token-lost: GHL rotation succeeded but KV persist failed — manual re-auth likely required",
      };
    }

    // A fully-persisted successful refresh proves the token chain is healthy —
    // clear any latched token-lost marker from a previous incident.
    try { await kv.delete(KV_TOKEN_LOST_KEY); } catch { /* non-fatal */ }

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
