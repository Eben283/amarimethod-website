// Auth gate for the ops READ endpoints (/api/daily-audit, /api/ecosystem-scan).
// Those return cached audit/scan data that includes client PII — names, session
// counts, payment/owed state — so they must not be world-readable (they shipped
// with no auth + Access-Control-Allow-Origin: *). Their only consumer is the local
// /day skill (server-to-server fetch), so a shared service key is the right fit —
// no browser, no CORS, no user session.
//
// ── Fail-CLOSED semantics ──
// If OPS_READ_KEY is NOT configured, requests are DENIED with 503 (the endpoint
// refuses to serve PII unauthenticated). Rollout-safe (fail-open) through
// 2026-07-03; the key is now set in the Pages env, so as of 2026-07-04 it fails
// closed — a future unset/rotation-gap can't silently expose the audit/scan PII.
// The key must be set in the Pages env:
//
//   openssl rand -hex 32 | npx wrangler pages secret put OPS_READ_KEY --project-name amarimethod-website
//
// and mirrored into Bitwarden (OPS_READ_KEY). Every request must then present either
//   X-Service-Key: <OPS_READ_KEY>     or     Authorization: Bearer <OPS_READ_KEY>
// The /day skill reads OPS_READ_KEY from Bitwarden via bws (Keychain retired 2026-07-04).

import { timingSafeEqual } from "./safe-equal.js";

// Returns null when authorized, or a Response when denied: 500 when the key is
// unset (fail closed — misconfigured), or 401 when a configured key is
// missing/incorrect. Call at the very top of onRequestGet:
//   const denied = requireOpsReadKey(context.request, context.env);
//   if (denied) return denied;
export function requireOpsReadKey(request, env, responseHeaders = {}) {
  const headers = { ...responseHeaders, "Content-Type": "application/json" };
  const key = env.OPS_READ_KEY;
  if (!key) {
    console.error(
      "[ops-auth] OPS_READ_KEY not set — denying protected Ops read (fail closed). " +
        "Set the Pages secret to serve this endpoint."
    );
    return new Response(JSON.stringify({ error: "auth not configured" }), {
      status: 500,
      headers,
    });
  }
  const headerKey = request.headers.get("X-Service-Key") || "";
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const provided = headerKey || bearer;
  if (!provided || !timingSafeEqual(provided, key)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers,
    });
  }
  return null;
}

// True once the gate is active (key configured). Surface in /status-style payloads
// so "is ops auth actually on?" is observable without reading logs.
export function opsReadKeyActive(env) {
  return Boolean(env.OPS_READ_KEY);
}
