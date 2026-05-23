// Cloudflare Pages Function: GET /api/staff-partner-activity?contactId=XYZ
//
// Returns a chronological activity timeline for one contact, merging:
//   - Conversation messages (calls / SMS / email) via /conversations/search + /conversations/{id}/messages
//   - Notes via /contacts/{id}/notes
//
// Used by the Partners tab modal — lazy-loaded when a card is opened.
// Returns events sorted most-recent first, limited to ~50 events.
//
// Auth: JWT bearer.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const MAX_EVENTS = 50;

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

// GHL message types per the research report. Map to our 4 channel types.
function mapMessageType(typeStr) {
  const t = String(typeStr || "").toUpperCase();
  if (t.includes("CALL")) return "call";
  if (t.includes("EMAIL")) return "email";
  if (t.includes("SMS")) return "sms";
  return null;  // skip unknown types
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
    try {
      await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401, headers });
    }

    const url = new URL(context.request.url);
    const contactId = url.searchParams.get("contactId");
    if (!contactId) {
      return new Response(JSON.stringify({ error: "contactId query param required" }), { status: 400, headers });
    }

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) {
      return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });
    }

    const events = [];

    // 1) Conversations → messages
    const convRes = await fetch(
      `${GHL_API_BASE}/conversations/search?contactId=${encodeURIComponent(contactId)}&locationId=${GHL_LOCATION_ID}`,
      { headers: ghlHeaders(ghlToken) },
    );
    if (convRes.ok) {
      const convData = await convRes.json();
      const conversations = (convData.conversations || []).slice(0, 5);  // top 5 most recent threads
      for (const conv of conversations) {
        const msgRes = await fetch(
          `${GHL_API_BASE}/conversations/${conv.id}/messages?limit=20`,
          { headers: ghlHeaders(ghlToken) },
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();
        // GHL double-nests: msgData.messages.messages
        const messages = msgData.messages?.messages || [];
        for (const m of messages) {
          const chan = mapMessageType(m.type);
          if (!chan) continue;
          events.push({
            date: m.dateAdded || m.date,
            type: chan,
            direction: m.direction === "inbound" ? "inbound" : "outbound",
            body: typeof m.body === "string" ? m.body.replace(/<[^>]*>/g, "").slice(0, 200) : undefined,
          });
        }
      }
    }

    // 2) Notes
    const notesRes = await fetch(
      `${GHL_API_BASE}/contacts/${contactId}/notes`,
      { headers: ghlHeaders(ghlToken) },
    );
    if (notesRes.ok) {
      const notesData = await notesRes.json();
      for (const n of notesData.notes || []) {
        events.push({
          date: n.dateAdded || n.createdAt,
          type: "note",
          body: typeof n.body === "string" ? n.body.slice(0, 500) : "",
        });
      }
    }

    // Sort most-recent first, cap to MAX_EVENTS
    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const trimmed = events.slice(0, MAX_EVENTS);

    return new Response(
      JSON.stringify({
        contactId,
        generatedAt: new Date().toISOString(),
        events: trimmed,
        totalFetched: events.length,
        truncated: events.length > MAX_EVENTS,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-partner-activity] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to load activity: ${detail}` }),
      { status: 500, headers },
    );
  }
}
