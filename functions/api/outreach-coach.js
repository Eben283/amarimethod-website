// Cloudflare Pages Function: GET /api/outreach-coach
//
// Reads the outreach-coach record for one contact from PORTAL_KV and returns it
// to the staff Follow-Up card. Records are written by the local coach generator
// (Claude on the subscription) keyed by contact:
//   coach:{contactId} → { contactId, name, bucket, whyNow, message, channel, generatedAt }
//
// This is the "who to reach out to, about what, with the message to send" layer
// that sits on the Follow-Up card. It's separate from /api/call-coach (which is
// per-call coaching keyed by date).
//
// Auth: JWT staff bearer. CORS modeled on call-coach.js.

import { verifySessionToken } from "../lib/auth.js";

const KV_COACH_PREFIX = "coach:";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401, headers });
    }
    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const kv = context.env.PORTAL_KV;
    if (!kv) {
      return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers });
    }

    const contactId = new URL(context.request.url).searchParams.get("contactId");
    if (!contactId) {
      return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
    }
    // GHL ids are alphanumeric — reject anything else so a crafted contactId can't
    // reach outside the coach: namespace into other KV keys.
    if (!/^[A-Za-z0-9]+$/.test(contactId)) {
      return new Response(JSON.stringify({ error: "Invalid contactId" }), { status: 400, headers });
    }

    const record = await kv.get(`${KV_COACH_PREFIX}${contactId}`, "json");
    if (!record) {
      return new Response(
        JSON.stringify({ contactId, coach: null, message: "No coaching for this contact" }),
        { status: 200, headers },
      );
    }
    // Normalize: the card checks for `coach`. Wrap if the record is stored flat.
    return new Response(JSON.stringify({ contactId, coach: record }), { status: 200, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[outreach-coach] reader failed:", detail);
    return new Response(JSON.stringify({ error: `Failed to load coaching: ${detail}` }), { status: 500, headers });
  }
}
