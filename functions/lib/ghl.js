// Shared GHL API utility — OAuth2 auto-refresh via Cloudflare KV
// All API functions import from here instead of using static GHL_API_KEY.

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// KV keys
const KV_ACCESS_TOKEN = "ghl_access_token";
const KV_REFRESH_TOKEN = "ghl_refresh_token";
const KV_TOKEN_EXPIRY = "ghl_token_expiry";

/**
 * Build standard GHL API headers from a Bearer token.
 * Replaces the duplicated ghlHeaders() in every API file.
 */
export function ghlHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

/**
 * Get a valid GHL access token. Auto-refreshes from KV if expired.
 * Falls back to static GHL_API_KEY env var if OAuth2 is not yet configured.
 */
export async function getGhlToken(context) {
  const kv = context.env.PORTAL_KV;

  // If KV is available, try OAuth2 tokens first
  if (kv) {
    try {
      const [accessToken, expiryStr] = await Promise.all([
        kv.get(KV_ACCESS_TOKEN),
        kv.get(KV_TOKEN_EXPIRY),
      ]);

      const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
      const now = Date.now();

      // Token exists and is not expired (with buffer)
      if (accessToken && expiry > now + REFRESH_BUFFER_MS) {
        return accessToken;
      }

      // Token expired or missing — try to refresh
      const refreshToken = await kv.get(KV_REFRESH_TOKEN);
      if (refreshToken) {
        const newToken = await refreshGhlToken(context, refreshToken);
        if (newToken) {
          return newToken;
        }
      }
    } catch (err) {
      console.error("[ghl] KV token read error:", err.message);
    }
  }

  // Fallback: static API key from env (legacy, pre-OAuth2)
  const staticKey = context.env.GHL_API_KEY;
  if (staticKey) {
    return staticKey;
  }

  throw new Error("No GHL API credentials available");
}

// Single-flight latch (per isolate). GHL issues SINGLE-USE refresh tokens: each
// refresh invalidates the previous refresh token and returns a new one. If two
// requests refresh concurrently with the same token, one wins and the other's
// token is already dead — and whichever writes KV last can leave a stale/invalid
// refresh token stored, cascading into global 401s until manual re-auth.
//
// This latch collapses concurrent refreshes WITHIN one isolate to a single
// network call. The double-checked KV read inside performTokenRefresh covers the
// cross-isolate case: a second refresher re-reads KV first and reuses the token a
// peer just wrote instead of burning the refresh token again. This is a mitigation,
// not an airtight distributed lock (KV has no atomic CAS) — the cron token-worker
// keeping tokens fresh with a 6h margin is what makes on-demand refresh rare.
let refreshInFlight = null;

/**
 * Refresh the GHL OAuth2 access token using the refresh token.
 * Stores new tokens in KV and returns the new access token (or null on failure).
 * Concurrent calls within one isolate share a single in-flight refresh.
 */
function refreshGhlToken(context, refreshToken, options = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performTokenRefresh(context, refreshToken, options).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performTokenRefresh(context, refreshToken, options = {}) {
  const kv = context.env.PORTAL_KV;
  // The 401-retry path passes the token GHL just rejected. The double-check must
  // NOT hand that same token back — only short-circuit when KV holds a DIFFERENT
  // (peer-refreshed) token. Without this, a token rejected before its stored
  // expiry would be returned unchanged and the retry would 401 again, defeating
  // the self-heal. Undefined for the expiry-driven path (any valid token is fine).
  const knownBadToken = options.knownBadToken;

  // Double-check: another isolate (or the cron token-worker) may have just
  // refreshed. If KV already holds a still-valid access token, reuse it rather
  // than burning the single-use refresh token on a redundant refresh.
  if (kv) {
    try {
      const [existingToken, expiryStr] = await Promise.all([
        kv.get(KV_ACCESS_TOKEN),
        kv.get(KV_TOKEN_EXPIRY),
      ]);
      const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
      if (existingToken && existingToken !== knownBadToken && expiry > Date.now() + REFRESH_BUFFER_MS) {
        return existingToken;
      }
    } catch (err) {
      console.error("[ghl] KV double-check read error:", err.message);
    }
  }

  const clientId = context.env.GHL_CLIENT_ID;
  const clientSecret = context.env.GHL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[ghl] Missing GHL_CLIENT_ID or GHL_CLIENT_SECRET");
    return null;
  }

  // Use the freshest refresh token available — the one passed in may already be
  // stale if a peer refreshed between the caller's read and now.
  let currentRefreshToken = refreshToken;
  if (kv) {
    try {
      currentRefreshToken = (await kv.get(KV_REFRESH_TOKEN)) || refreshToken;
    } catch (err) {
      console.error("[ghl] KV refresh-token read error:", err.message);
    }
  }

  try {
    const response = await fetch(GHL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: currentRefreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[ghl] Token refresh failed: ${response.status} ${errText}`);
      return null;
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token;
    const expiresIn = data.expires_in || 86399; // Default ~24h

    if (!newAccessToken) {
      console.error("[ghl] No access_token in refresh response");
      return null;
    }

    // Store new tokens in KV
    const newExpiry = Date.now() + expiresIn * 1000;

    if (kv) {
      await Promise.all([
        kv.put(KV_ACCESS_TOKEN, newAccessToken),
        kv.put(KV_REFRESH_TOKEN, newRefreshToken || currentRefreshToken),
        kv.put(KV_TOKEN_EXPIRY, String(newExpiry)),
      ]);
    }

    console.log("[ghl] Token refreshed successfully");
    return newAccessToken;
  } catch (err) {
    console.error("[ghl] Token refresh error:", err.message);
    return null;
  }
}

/**
 * Fetch wrapper for GHL API calls with auto-retry on 401, 429, and 5xx.
 * - 401: refreshes OAuth token and retries once.
 * - 429: waits using Retry-After header (or exponential backoff) then retries.
 * - 5xx: retries with exponential backoff.
 * Max 3 retry attempts for 429/5xx. 1 retry for 401.
 *
 * @param {object} context - Cloudflare Pages context (for env/KV)
 * @param {string} url - Full GHL API URL
 * @param {object} options - Fetch options (method, body, etc.) — headers are auto-set
 * @returns {Response} The fetch response
 */
export async function ghlFetch(context, url, options = {}) {
  const token = await getGhlToken(context);
  const headers = { ...ghlHeaders(token), ...options.headers };

  let response = await fetch(url, { ...options, headers });

  // 401 — token expired mid-request, refresh and retry once
  if (response.status === 401) {
    console.warn("[ghl] Got 401, attempting token refresh and retry");
    const kv = context.env.PORTAL_KV;
    if (kv) {
      const refreshToken = await kv.get(KV_REFRESH_TOKEN);
      if (refreshToken) {
        // Pass the rejected token so the refresh double-check forces a real
        // refresh instead of handing back the same token that just 401'd.
        const newToken = await refreshGhlToken(context, refreshToken, { knownBadToken: token });
        if (newToken && newToken !== token) {
          const retryHeaders = { ...ghlHeaders(newToken), ...options.headers };
          return fetch(url, { ...options, headers: retryHeaders });
        }
      }
    }
    return response;
  }

  // 429 / 5xx — retry with backoff (max 3 attempts).
  //
  // Only retry 5xx for IDEMPOTENT methods. A POST/PATCH that returns 5xx may
  // have already committed server-side (GHL stamps the error AFTER the write),
  // so a blind retry can double-create contacts/tags/appointments/charges. A 429
  // means the request was rejected before processing (rate limit), so it is
  // always safe to retry regardless of method.
  const method = (options.method || "GET").toUpperCase();
  const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
  const canRetry5xx = IDEMPOTENT_METHODS.has(method);

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const retryable = response.status === 429 || (response.status >= 500 && canRetry5xx);
    if (!retryable) break;

    const retryAfter = response.headers.get("Retry-After");
    const backoffMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : Math.min(1000 * Math.pow(2, attempt), 10000);

    console.warn(
      `[ghl] ${response.status} on ${url.split("?")[0]} — retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms`,
    );

    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    const currentToken = await getGhlToken(context);
    const retryHeaders = { ...ghlHeaders(currentToken), ...options.headers };
    response = await fetch(url, { ...options, headers: retryHeaders });
  }

  return response;
}

/**
 * Apply an additive tag delta to a contact WITHOUT replacing its full tag array.
 *
 * The contact PUT endpoint (`PUT /contacts/{id}` with a `tags` field) replaces
 * the tag array wholesale, so any tag a concurrent GHL workflow added between
 * our read and our write is silently lost — and many GHL workflow triggers are
 * tag-driven, so a lost-update here can break unrelated automations. GHL's
 * dedicated tag endpoints mutate only the named tags and leave every other tag
 * untouched, which is the safe way to add/remove tags.
 *
 * Both endpoints are idempotent in practice: re-adding a present tag or
 * removing an absent one is a harmless no-op, so this is safe to retry.
 *
 * @param {object} context - Cloudflare context (env/KV)
 * @param {string} contactId
 * @param {{ add?: string[], remove?: string[] }} delta
 * @returns {Promise<{ added: string[], removed: string[] }>}
 */
export async function applyTagDelta(context, contactId, { add = [], remove = [] } = {}) {
  const added = [...new Set(add)].filter(Boolean);
  const removed = [...new Set(remove)].filter(Boolean);

  if (removed.length) {
    const res = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${contactId}/tags`,
      { method: "DELETE", body: JSON.stringify({ tags: removed }) },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`tag remove failed (${res.status}): ${errText}`);
    }
  }

  if (added.length) {
    const res = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${contactId}/tags`,
      { method: "POST", body: JSON.stringify({ tags: added }) },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`tag add failed (${res.status}): ${errText}`);
    }
  }

  return { added, removed };
}
