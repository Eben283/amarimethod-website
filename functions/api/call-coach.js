// Cloudflare Pages Function: GET /api/call-coach
//
// Reads call-coaching results produced by the call-coach Worker cron from
// PORTAL_KV and returns them to the staff Follow-Up app:
//   - ?contactId=XYZ[&date=YYYY-MM-DD] → one contact's coaching for that day
//     (key call-coach:{date}:{contactId}). Used by the Follow-Up card.
//   - ?date=YYYY-MM-DD (no contactId)  → that day's digest
//     (key call-coach:daily:{date}). Used by the /day briefing surface.
// date defaults to yesterday Pacific (the coach runs on yesterday's calls).
//
// Auth: JWT staff bearer. CORS modeled on staff-partner-activity.js.

import { verifySessionToken } from "../lib/auth.js";

const PT = "America/Los_Angeles";
const KV_CALL_PREFIX = "call-coach:";
const KV_DAILY_PREFIX = "call-coach:daily:";
const KV_LATEST_PREFIX = "call-coach:latest:";

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

function yesterdayPacific() {
  const d = new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(d);
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

    const url = new URL(context.request.url);
    const dateParam = url.searchParams.get("date");
    const contactId = url.searchParams.get("contactId");

    if (contactId) {
      // No explicit date → the persistent "latest" pointer (the last call we coached for
      // this contact, used by the Follow-Up card). With a date → that day's record (back-compat).
      const key = dateParam
        ? `${KV_CALL_PREFIX}${dateParam}:${contactId}`
        : `${KV_LATEST_PREFIX}${contactId}`;
      const record = await kv.get(key, "json");
      if (!record) {
        return new Response(
          JSON.stringify({ contactId, date: dateParam || null, coaching: null, message: "No coaching for this contact" }),
          { status: 200, headers },
        );
      }
      return new Response(JSON.stringify(record), { status: 200, headers });
    }

    // No contactId → daily digest.
    const date = dateParam || yesterdayPacific();
    const digest = await kv.get(`${KV_DAILY_PREFIX}${date}`, "json");
    if (!digest) {
      return new Response(
        JSON.stringify({ date, count: 0, items: [], message: "No coaching digest for this date" }),
        { status: 200, headers },
      );
    }
    return new Response(JSON.stringify(digest), { status: 200, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[call-coach] reader failed:", detail);
    return new Response(JSON.stringify({ error: `Failed to load coaching: ${detail}` }), { status: 500, headers });
  }
}
