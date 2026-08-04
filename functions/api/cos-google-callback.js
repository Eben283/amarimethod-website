// Cloudflare Pages Function: GET /api/cos-google-callback
// Completes the one-time Google Calendar OAuth reconnect started by COS.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALLBACK_URL = "https://www.amarimethod.com/api/cos-google-callback";
const SUCCESS_URL = "https://www.amarimethod.com/cos/?google=connected";
const FAILURE_URL = "https://www.amarimethod.com/cos/?google=failed";

function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const stateKey = state ? `cos:google-oauth:${state}` : "";

  if (!stateKey || !context.env.PORTAL_KV) return redirect(FAILURE_URL);

  const saved = await context.env.PORTAL_KV.get(stateKey);
  // Always make state single-use, including when Google returned an error.
  await context.env.PORTAL_KV.delete(stateKey);
  if (!saved || !code || url.searchParams.has("error")) return redirect(FAILURE_URL);

  let grant;
  try {
    grant = JSON.parse(saved);
  } catch {
    return redirect(FAILURE_URL);
  }
  if (grant.user !== "Eben" || !context.env.GOOGLE_OAUTH_CLIENT_ID || !context.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return redirect(FAILURE_URL);
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: context.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: context.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: CALLBACK_URL,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    return redirect(FAILURE_URL);
  }
  if (!tokenResponse.ok) return redirect(FAILURE_URL);

  let token;
  try {
    token = await tokenResponse.json();
  } catch {
    return redirect(FAILURE_URL);
  }
  if (!token.access_token || !token.refresh_token) return redirect(FAILURE_URL);

  const user = "eben";
  const expiry = Date.now() + Number(token.expires_in || 3600) * 1000;
  await Promise.all([
    context.env.PORTAL_KV.put(`google:${user}:access_token`, token.access_token),
    context.env.PORTAL_KV.put(`google:${user}:refresh_token`, token.refresh_token),
    context.env.PORTAL_KV.put(`google:${user}:token_expiry`, String(expiry)),
  ]);

  // The chat endpoint caches its assembled Calendar context for five minutes.
  // Without clearing a pre-consent cache, the first post-reconnect answer can
  // still be told that Calendar is unavailable even though the new grant works.
  await context.env.PORTAL_KV.delete(`cos:cache:${user}:${todayKey()}`).catch((err) => {
    console.error("[cos-google-callback] failed to invalidate Calendar context cache", err);
  });

  return redirect(SUCCESS_URL);
}
