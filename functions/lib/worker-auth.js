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
// ── Rollout-safe semantics (important) ──
// If WORKER_AUTH_SECRET is NOT configured on the worker, requests are ALLOWED
// and a warning is logged. This makes DEPLOYING this code a no-op — nothing
// breaks — until you ACTIVATE the gate by setting the secret:
//
//   echo "<same-secret-everywhere>" | npx wrangler secret put WORKER_AUTH_SECRET
//
// run once in each of the five worker directories, plus the same value set as
// a Pages env var (staff-refresh-activity.js reads it to call the partner
// worker). Once the secret is set, every request must present:
//
//   Authorization: Bearer <secret>
//
// Generate a value with: openssl rand -hex 32

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

// Returns null when the request is authorized (or auth is not yet configured),
// or a 401 Response when a configured secret is missing/incorrect. Callers
// should `const denied = requireWorkerAuth(request, env); if (denied) return denied;`
// at the very top of fetch().
export function requireWorkerAuth(request, env) {
  const secret = env.WORKER_AUTH_SECRET;
  if (!secret) {
    console.warn(
      "[worker-auth] WORKER_AUTH_SECRET not set — HTTP endpoints are UNAUTHENTICATED. " +
        "Set the secret (wrangler secret put WORKER_AUTH_SECRET) to activate the gate."
    );
    return null;
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
