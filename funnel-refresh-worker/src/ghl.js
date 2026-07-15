// GHL API helpers for the funnel-refresh Worker.
// Tokens are managed in PORTAL_KV by the ghl-token-refresh worker. Token
// plumbing itself lives in the shared functions/lib/ghl-worker-token.js
// (2026-07-01 — extracted from 7 identical per-Worker copies during the
// cron-job architecture audit). This module adds a `ghlRetry` wrapper that
// ports funnel.mjs's 429 exponential-backoff (GHL burst-limits aggressively).

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { fetchWithRetry } from "../../functions/lib/fetch-retry.js";

export { getAccessToken };

const GHL_BASE = "https://services.leadconnectorhq.com";

// Same location the local funnel.mjs uses (tokens.json location_id) — verified
// 2026-06-12 to equal 7pIO7FHVAyBT1jKGhfQM.
export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// ── GHL API fetch ──
// Mirrors ghl-client.js ghlFetch: auto-injects locationId unless the path already
// carries locationId/location_id/altId, sends the Version header + Bearer token.
// `path` is everything after GHL_BASE, e.g. "/contacts/?limit=100".

export async function ghlFetch(env, path) {
  const token = await getAccessToken(env);
  const url = new URL(`${GHL_BASE}${path}`);
  if (
    !url.searchParams.has("locationId") &&
    !url.searchParams.has("location_id") &&
    !url.searchParams.has("altId")
  ) {
    url.searchParams.set("locationId", LOCATION_ID);
  }

  // fetchWithRetry: per-attempt timeout + backoff on network/timeout/5xx/429.
  // A single hung GHL call used to stall the whole ~400-subrequest run until the
  // Worker wall-clock limit killed it (the 30s-timeout funnel failure); now it
  // aborts early and retries. ghlRetry below still adds the longer 429 backoff.
  const res = await fetchWithRetry(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL API ${res.status}: ${errText}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ghlFetch with exponential backoff on 429 — direct port of funnel.mjs ghlRetry.
export async function ghlRetry(env, path, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      return await ghlFetch(env, path);
    } catch (e) {
      if (!/429/.test(e.message) || i === tries - 1) throw e;
      await sleep(600 * 2 ** i + Math.floor(600 * Math.random()));
    }
  }
}
