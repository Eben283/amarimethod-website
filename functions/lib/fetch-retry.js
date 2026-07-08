// fetch-retry.js — transient-failure wrapper around global fetch (WEB repo).
//
// WHY: the GHL API and Cloudflare KV both fail transiently — a slow response
// that hangs the whole invocation, a 429 burst-limit, a 5xx, a network blip
// right after a scheduled wake. The funnel-refresh worker fans out ~400 GHL
// subrequests in one run; without a per-attempt timeout a SINGLE hung call
// stalls the run until the Worker's wall-clock limit kills it (this is the
// 2026-07-08 "GHL 30-second timeout" the funnel cron died on, caught by the
// Build-1 heartbeat). This adds a bounded retry with exponential backoff +
// jitter and a per-attempt AbortController timeout, so a blip aborts early and
// retries instead of collapsing the run.
//
// Mirrors ghl-mcp/fetch-retry.js (the MCP repo's copy) — same shape on both
// sides of the KV boundary, one copy per repo. Returns the final Response so
// each caller keeps its own ok / non-ok semantics (ghlFetch throws on non-2xx,
// a KV read maps 404→null, etc.). Jitter is added here because at ~400
// concurrent calls, deterministic backoff would retry in lockstep and re-hammer
// GHL's burst limiter.

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetchWithRetry(url, fetchOptions, { attempts, timeoutMs, baseDelayMs })
// Retries on network errors, per-attempt timeouts, and retryable status codes
// only. Non-retryable responses (2xx, and 4xx other than 408/425/429) return
// immediately. When the LAST attempt is a retryable status, its Response is
// returned (the caller decides what a persistent 429/5xx means); network/timeout
// errors on the last attempt are thrown.
export async function fetchWithRetry(url, options = {}, cfg = {}) {
  const { attempts = 3, timeoutMs = 8000, baseDelayMs = 300 } = cfg;
  let lastErr;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) {
        await delay(backoffMs(baseDelayMs, attempt));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < attempts) {
        await delay(backoffMs(baseDelayMs, attempt));
        continue;
      }
      throw err;
    }
  }
  // Only reached if the last iteration was a retryable status that fell through.
  throw lastErr || new Error("fetchWithRetry: exhausted attempts");
}

// Exponential backoff with full jitter: a random point in [0, base * 2^(n-1)].
// Full jitter spreads concurrent retries out instead of bunching them at the
// same instant. Math.random is fine here — this is load-spreading, not crypto.
function backoffMs(baseDelayMs, attempt) {
  const ceil = baseDelayMs * 2 ** (attempt - 1);
  return Math.floor(Math.random() * ceil);
}
