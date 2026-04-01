// Cloudflare Pages Function: GET /api/cos-spotify-auth
// Initiates Spotify OAuth2 flow — user visits this URL once to connect Spotify

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
].join(" ");

export async function onRequestGet(context) {
  const clientId = context.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return new Response("SPOTIFY_CLIENT_ID not configured", { status: 500 });
  }

  const redirectUri = `https://ebenforrest.com/api/cos-spotify-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    show_dialog: "true",
  });

  return Response.redirect(`${SPOTIFY_AUTH_URL}?${params}`, 302);
}
