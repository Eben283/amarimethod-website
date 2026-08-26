// Cloudflare Pages Function: GET /api/stream-health
//
// Unauthenticated liveness probe for Cloudflare Stream signing. Mints a
// short-lived signed token for a known course video using the SAME production
// CF_STREAM_TOKEN / CF_ACCOUNT_ID that /api/stream-token uses, then returns
// ONLY a boolean — never the token itself.
//
// Why this exists: the 2026-06-02 Living Practice outage was a stale
// CF_STREAM_TOKEN in the Pages env var (the underlying Stream API token had
// been rolled, the env var never updated). It went unnoticed because nothing
// exercised the signing path until a real user hit a video. This endpoint
// exercises the real production env var once a day (the daily-audit worker
// calls it), so a stale token surfaces in /day within ~24h instead of via a
// customer complaint.
//
// Deliberately does NOT duplicate the token into the worker — that would create
// a second place to keep in sync, the exact failure mode that caused the
// outage. The probe runs against the live Pages env var, so there is nothing to
// drift.
//
// Returns 200 with { healthy } in all cases (never 5xx — Pages intercepts
// 502/503 and replaces the body). Returns no token and no secret material.

// "Welcome to Living Practice" — the first video every member sees. Checking
// its actual signed HLS manifest catches an unavailable/unready asset as well
// as a stale signing credential. If this UID is ever deleted, the probe reports
// reason="test-video-missing" so the monitor can be updated deliberately.
const TEST_UID = "9072ff146ba6434f9463ae78c6616e3d";

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

export async function onRequestGet(context) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  // Same env var names production /api/stream-token uses (CF_STREAM_ACCOUNT_ID,
  // not CF_ACCOUNT_ID — they differ).
  const CF_ACCOUNT_ID = context.env.CF_STREAM_ACCOUNT_ID;
  const CF_STREAM_TOKEN = context.env.CF_STREAM_TOKEN;
  const CUSTOMER_CODE = context.env.CF_STREAM_CUSTOMER_CODE;

  if (!CF_ACCOUNT_ID || !CF_STREAM_TOKEN || !CUSTOMER_CODE) {
    return new Response(
      JSON.stringify({ healthy: false, reason: "missing-env", checkedAt: new Date().toISOString() }),
      { status: 200, headers },
    );
  }

  const exp = Math.floor(Date.now() / 1000) + 120;
  let res, json;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${TEST_UID}/token`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ exp, downloadable: false }),
      },
    );
    json = await res.json().catch(() => null);
  } catch (err) {
    return new Response(
      JSON.stringify({ healthy: false, reason: "fetch-failed", detail: String(err).slice(0, 160), checkedAt: new Date().toISOString() }),
      { status: 200, headers },
    );
  }

  const signingHealthy = !!(res.ok && json && json.success && json.result && json.result.token);
  let reason = null;
  if (!signingHealthy) {
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      reason = "token-invalid";          // stale/revoked CF_STREAM_TOKEN — the outage signature
    } else if (res.status === 404) {
      reason = "test-video-missing";     // UID deleted — update TEST_UID, not the token
    } else {
      reason = "stream-api-error";
    }
  }

  if (!signingHealthy) {
    return new Response(
      JSON.stringify({
        healthy: false,
        reason,
        status: res.status,
        testUid: TEST_UID,
        checkedAt: new Date().toISOString(),
        // first CF error message only (no secret material), for the alert detail
        detail: (json && json.errors && json.errors[0] && json.errors[0].message) || null,
      }),
      { status: 200, headers },
    );
  }

  // A token alone is not proof that a browser can start playback. Fetch the
  // exact HLS manifest the player receives, server-side, and return only safe
  // diagnostics — never the customer code, token, or playlist contents.
  let manifestRes, manifest;
  try {
    const manifestUrl = `https://customer-${CUSTOMER_CODE}.cloudflarestream.com/${json.result.token}/manifest/video.m3u8`;
    manifestRes = await fetch(manifestUrl, {
      headers: { Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*" },
    });
    manifest = await manifestRes.text();
  } catch (err) {
    return new Response(
      JSON.stringify({
        healthy: false,
        reason: "manifest-fetch-failed",
        testUid: TEST_UID,
        checkedAt: new Date().toISOString(),
        detail: String(err).slice(0, 160),
      }),
      { status: 200, headers },
    );
  }

  const playlistValid = manifestRes.ok
    && manifest.startsWith("#EXTM3U")
    && (manifest.includes("#EXT-X-STREAM-INF") || manifest.includes("#EXTINF"));

  return new Response(
    JSON.stringify({
      healthy: playlistValid,
      reason: playlistValid ? null : "manifest-unavailable",
      status: res.status,
      manifestStatus: manifestRes.status,
      testUid: TEST_UID,
      checkedAt: new Date().toISOString(),
      // Status/shape only; no playback URL, token, or Stream response body.
      playlistValid,
    }),
    { status: 200, headers },
  );
}
