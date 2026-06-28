// Shared auth + CORS helpers for staff-* endpoints.
// Eliminates ~22 lines of boilerplate that previously appeared verbatim in every endpoint.

import { verifySessionToken } from "./auth.js";
import { requireOpsReadKey } from "./ops-auth.js";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

// Standard CORS headers. Pass the HTTP methods the endpoint supports,
// e.g. "GET, OPTIONS" (default) or "POST, OPTIONS".
export function corsHeaders(origin, methods = "GET, OPTIONS") {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// Validates the staff Bearer JWT.
//
// Pass the already-computed response headers so error Responses include CORS headers.
//
// Returns either:
//   { error: Response }  — caller should:  if (error) return error;
//   { payload: ... }     — the verified token payload, ready to use
//
// Usage:
//   const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
//   if (error) return error;
//
export async function requireStaffAuth(context, headers) {
  const secret = context.env.JWT_SECRET;
  if (!secret) {
    return { error: new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers }) };
  }

  const auth = context.request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return { error: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers }) };
  }

  let payload;
  try {
    payload = await verifySessionToken(auth.slice(7), secret);
  } catch {
    return { error: new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers }) };
  }

  if (payload.role !== "staff") {
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers }) };
  }

  return { payload };
}

// Like requireStaffAuth, but also accepts internal service calls authenticated
// with the ops read key (X-Service-Key header) — used by staff-balances and
// staff-conversations when called from the /day skill.
export async function requireStaffOrOpsAuth(context, headers) {
  if (context.request.headers.get("X-Service-Key")) {
    const denied = requireOpsReadKey(context.request, context.env);
    if (denied) return { error: denied };
    return { payload: { role: "service" } };
  }
  return requireStaffAuth(context, headers);
}
