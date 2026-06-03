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

// "Jaw Align" — a signed (requireSignedURLs=true) Living Practice course video.
// If this UID is ever deleted, the probe reports reason="test-video-missing"
// (info, not critical) so it's clear the probe needs maintenance, not the token.
const TEST_UID = "de9f0388d4c9e987d30ede97eedc84a2";

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

export async function onRequestGet(context) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const CF_ACCOUNT_ID = context.env.CF_ACCOUNT_ID;
  const CF_STREAM_TOKEN = context.env.CF_STREAM_TOKEN;

  if (!CF_ACCOUNT_ID || !CF_STREAM_TOKEN) {
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

  const healthy = !!(res.ok && json && json.success && json.result && json.result.token);
  let reason = null;
  if (!healthy) {
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      reason = "token-invalid";          // stale/revoked CF_STREAM_TOKEN — the outage signature
    } else if (res.status === 404) {
      reason = "test-video-missing";     // UID deleted — update TEST_UID, not the token
    } else {
      reason = "stream-api-error";
    }
  }

  return new Response(
    JSON.stringify({
      healthy,
      reason,
      status: res.status,
      testUid: TEST_UID,
      checkedAt: new Date().toISOString(),
      // first CF error message only (no secret material), for the alert detail
      detail: healthy ? undefined : (json && json.errors && json.errors[0] && json.errors[0].message) || null,
    }),
    { status: 200, headers },
  );
}
