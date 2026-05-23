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

// GHL message-type mapper.
// GHL is inconsistent: /conversations/search returns string enums ("TYPE_CALL"),
// while /conversations/{id}/messages returns NUMERIC codes (1, 2, 3, ...).
// Accept both.
//
// Numeric enum (from GHL API v2 docs):
//   1 CALL, 2 SMS, 3 EMAIL, 4 SMS_REVIEW_REQUEST, 5 WEBCHAT, 6 SMS_NO_SHOW_REQUEST,
//   7 CAMPAIGN_SMS, 8 CAMPAIGN_CALL, 9 CAMPAIGN_EMAIL, 10 CAMPAIGN_VOICEMAIL,
//   11 FACEBOOK, 12 CAMPAIGN_FACEBOOK, 13 CAMPAIGN_MANUAL_CALL,
//   14 CAMPAIGN_MANUAL_SMS, 15 GMB, 16 CAMPAIGN_GMB, 17 REVIEW, 18 INSTAGRAM,
//   19 WHATSAPP, 20 CUSTOM_SMS, 21 CUSTOM_EMAIL, 22 IVR_CALL,
//   23-26 ACTIVITY_* (contact/invoice/payment/opportunity — system events, skip),
//   27 LIVE_CHAT, 28 LIVE_CHAT_INFO_MESSAGE (system, skip),
//   29 TIKTOK, 30 TIKTOK_DIRECT_MESSAGE
const NUMERIC_TYPE_MAP = {
  1: "call", 8: "call", 13: "call", 22: "call",
  2: "sms", 7: "sms", 14: "sms", 20: "sms", 4: "sms", 6: "sms",
  3: "email", 9: "email", 21: "email",
};

function mapMessageType(typeRaw) {
  if (typeRaw === null || typeRaw === undefined) return null;
  // Numeric: lookup in map
  if (typeof typeRaw === "number") return NUMERIC_TYPE_MAP[typeRaw] || null;
  // Numeric string ("1")
  const asNum = Number(typeRaw);
  if (Number.isFinite(asNum) && String(asNum) === String(typeRaw).trim()) {
    return NUMERIC_TYPE_MAP[asNum] || null;
  }
  // String enum ("TYPE_CALL")
  const t = String(typeRaw).toUpperCase();
  if (t.includes("CALL")) return "call";
  if (t.includes("EMAIL")) return "email";
  if (t.includes("SMS")) return "sms";
  return null;
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
      const conversations = (convData.conversations || []).slice(0, 5);
      for (const conv of conversations) {
        const msgRes = await fetch(
          `${GHL_API_BASE}/conversations/${conv.id}/messages?limit=20`,
          { headers: ghlHeaders(ghlToken) },
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();
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

    // 2) Appointments (free sessions, partner sessions, etc.)
    const apptRes = await fetch(
      `${GHL_API_BASE}/contacts/${contactId}/appointments`,
      { headers: ghlHeaders(ghlToken) },
    );
    if (apptRes.ok) {
      const apptData = await apptRes.json();
      const appts = apptData.events || apptData.appointments || [];
      for (const a of appts) {
        events.push({
          date: a.startTime || a.start_time || a.dateAdded,
          type: "appointment",
          direction: undefined,
          body: `${a.title || "Appointment"} — ${a.appointmentStatus || a.status || "scheduled"}`,
        });
      }
    }

    // 3) Notes — filter out auto-generated migration/cleanup audit notes (system noise,
    // not business events). Keep manual notes Garrett or staff added.
    const NOISE_PATTERNS = [
      /^Migrated from /i,
      /^Migration noise cleanup/i,
      /^Late migration /i,
      /^Outcome: \w+/,  // outcome capture auto-notes get rendered as signals already
    ];
    const notesRes = await fetch(
      `${GHL_API_BASE}/contacts/${contactId}/notes`,
      { headers: ghlHeaders(ghlToken) },
    );
    if (notesRes.ok) {
      const notesData = await notesRes.json();
      for (const n of notesData.notes || []) {
        const body = typeof n.body === "string" ? n.body : "";
        const isNoise = NOISE_PATTERNS.some((pat) => pat.test(body.trim()));
        if (isNoise) continue;
        events.push({
          date: n.dateAdded || n.createdAt,
          type: "note",
          body: body.slice(0, 500),
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
