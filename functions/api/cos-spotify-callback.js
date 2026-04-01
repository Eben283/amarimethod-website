// Cloudflare Pages Function: GET /api/cos-spotify-callback
// Handles Spotify OAuth2 callback — exchanges code for tokens, stores in KV

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(errorPage(`Spotify authorization denied: ${error}`), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!code) {
    return new Response(errorPage("No authorization code received"), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const clientId = context.env.SPOTIFY_CLIENT_ID;
  const clientSecret = context.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(errorPage("SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not configured"), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  const redirectUri = `https://ebenforrest.com/api/cos-spotify-callback`;

  // Exchange code for tokens
  const tokenResp = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    console.error("[spotify-callback] Token exchange failed:", tokenResp.status, errText);
    return new Response(errorPage("Failed to exchange authorization code"), {
      status: 422,
      headers: { "Content-Type": "text/html" },
    });
  }

  const data = await tokenResp.json();
  const { access_token, refresh_token, expires_in } = data;

  if (!access_token || !refresh_token) {
    return new Response(errorPage("Invalid token response from Spotify"), {
      status: 422,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Store tokens in KV
  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(errorPage("KV storage not available"), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  const expiry = Date.now() + (expires_in || 3600) * 1000;

  await Promise.all([
    kv.put("spotify_access_token", access_token),
    kv.put("spotify_refresh_token", refresh_token),
    kv.put("spotify_token_expiry", String(expiry)),
  ]);

  return new Response(successPage(), {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

function successPage() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify Connected</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #121212; color: #E8E6E3;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #1E1E1E; border-radius: 16px; padding: 40px; text-align: center; max-width: 400px; }
  h1 { color: #1DB954; margin-bottom: 8px; }
  p { color: #A0A0A0; }
  a { color: #EBA584; text-decoration: none; }
</style></head>
<body><div class="card">
  <h1>Spotify Connected</h1>
  <p>Your Chief of Staff can now control your music.</p>
  <p style="margin-top:20px"><a href="/cos/">Back to CoS</a></p>
</div></body></html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify Error</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #121212; color: #E8E6E3;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #1E1E1E; border-radius: 16px; padding: 40px; text-align: center; max-width: 400px; }
  h1 { color: #EBA584; margin-bottom: 8px; }
  p { color: #A0A0A0; }
  a { color: #EBA584; text-decoration: none; }
</style></head>
<body><div class="card">
  <h1>Connection Failed</h1>
  <p>${message}</p>
  <p style="margin-top:20px"><a href="/api/cos-spotify-auth">Try Again</a></p>
</div></body></html>`;
}
