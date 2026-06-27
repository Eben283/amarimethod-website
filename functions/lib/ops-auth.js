// Auth gate for the ops READ endpoints (/api/daily-audit, /api/ecosystem-scan).
// Those return cached audit/scan data that includes client PII — names, session
// counts, payment/owed state — so they must not be world-readable (they shipped
// with no auth + Access-Control-Allow-Origin: *). Their only consumer is the local
// /day skill (server-to-server fetch), so a shared service key is the right fit —
// no browser, no CORS, no user session.
//
// ── Rollout-safe semantics ──
// If OPS_READ_KEY is NOT configured, requests are ALLOWED and a warning is logged,
// so DEPLOYING this code changes nothing until you ACTIVATE the gate by setting the
// secret. Activate with:
//
//   openssl rand -hex 32 | tee >(security add-generic-password -U -s am-ops-read-key -a "$USER" -w "$(cat)") \
//     | npx wrangler pages secret put OPS_READ_KEY --project-name amarimethod-website
//
// (or set each side manually). Once set, every request must present either
//   X-Service-Key: <OPS_READ_KEY>     or     Authorization: Bearer <OPS_READ_KEY>
// The /day skill reads the value from Keychain (am-ops-read-key) and sends the header.

import { timingSafeEqual } from "./safe-equal.js";

// Returns null when authorized (or auth not yet configured), or a 401 Response when
// a configured key is missing/incorrect. Call at the very top of onRequestGet:
//   const denied = requireOpsReadKey(context.request, context.env);
//   if (denied) return denied;
export function requireOpsReadKey(request, env) {
  const key = env.OPS_READ_KEY;
  if (!key) {
    console.warn(
      "[ops-auth] OPS_READ_KEY not set — /api/daily-audit + /api/ecosystem-scan are " +
        "UNAUTHENTICATED. Set the secret (wrangler pages secret put OPS_READ_KEY) to activate the gate."
    );
    return null;
  }
  const headerKey = request.headers.get("X-Service-Key") || "";
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const provided = headerKey || bearer;
  if (!provided || !timingSafeEqual(provided, key)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
