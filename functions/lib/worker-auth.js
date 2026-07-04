// Shared auth gate for the standalone Workers' public HTTP routes
// (series-reconcile, daily-audit, ghl-token, partner-activity-refresh,
// ecosystem-scanner). Without this, anyone who learns a worker's
// *.workers.dev URL can trigger GHL writes (/run, /backfill, /sync) or read
// client PII (/needs-review, /contact-counts, /latest) — CRIT-A, 2026-06-11
// review.
//
// Crons invoke the worker's scheduled() handler, NOT fetch(), so the cron path
// is unaffected by this gate. Only the HTTP surface is protected.
//
// ── Fail-CLOSED semantics (important) ──
// If WORKER_AUTH_SECRET is NOT configured on the worker, every HTTP request is
// DENIED with 503 (the endpoint refuses to serve unauthenticated). The gate was
// rollout-safe (fail-open) through 2026-07-03; the secret is now set on every
// worker + the Pages env, so as of 2026-07-04 it fails closed — a future
// unset/rotation-gap can no longer silently expose GHL-write / PII routes.
// The secret must be present on each worker:
//
//   echo "<same-secret-everywhere>" | npx wrangler secret put WORKER_AUTH_SECRET
//
// run once in each worker directory, plus the same value as a Pages env var
// (staff-refresh-activity.js reads it to call the partner worker). Every request
// must then present:
//
//   Authorization: Bearer <secret>
//
// Generate a value with: openssl rand -hex 32. Deploying a NEW worker? Set its
// secret in the SAME deploy — an unset secret now yields 503, not open access.

// Constant-time string compare (avoids leaking the secret via response timing).
// The length check leaks only the secret's length, which is not sensitive.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Returns null when the request is authorized, or a Response when denied:
// 503 when the secret is unset (fail closed — the gate is misconfigured), or
// 401 when a configured secret is missing/incorrect. Callers should
// `const denied = requireWorkerAuth(request, env); if (denied) return denied;`
// at the very top of fetch().
export function requireWorkerAuth(request, env) {
  const secret = env.WORKER_AUTH_SECRET;
  if (!secret) {
    console.error(
      "[worker-auth] WORKER_AUTH_SECRET not set — DENYING all HTTP requests (fail closed). " +
        "Set the secret (wrangler secret put WORKER_AUTH_SECRET) to serve this worker."
    );
    return new Response(JSON.stringify({ error: "auth not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const header = request.headers.get("Authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !timingSafeEqual(provided, secret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

// True once the gate is active (secret configured). Surfaced in /status payloads
// so "is auth actually on?" is observable without reading logs.
export function workerAuthActive(env) {
  return Boolean(env.WORKER_AUTH_SECRET);
}
