// Cloudflare Pages Function: GET /api/staff-conversations
// Returns conversations across the location that need a reply (inbound last message or unread).

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
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

// GHL returns direction as 1/2, "inbound"/"outbound", or occasionally numeric strings.
function isInbound(direction) {
  if (direction === undefined || direction === null) return false;
  const d = typeof direction === "string" ? direction.toLowerCase() : direction;
  return d === "inbound" || d === 1 || d === "1";
}

function normalizeMessageType(type) {
  if (!type) return "SMS";
  const t = String(type).toUpperCase();
  if (t.includes("EMAIL")) return "Email";
  if (t.includes("CALL")) return "Call";
  return "SMS";
}

function capitalize(s) {
  if (!s) return "";
  return s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function buildContactName(conv) {
  const first = capitalize(conv.contactName || conv.fullName || conv.firstName || "");
  const last = capitalize(conv.lastName || "");
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  return conv.email || conv.phone || "Unknown";
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers },
      );
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers,
      });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), {
        status: 401,
        headers,
      });
    }

    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers,
      });
    }

    // Filters: ?filter=needs_reply (default) | all | unread
    const url = new URL(context.request.url);
    const filterParam = (url.searchParams.get("filter") || "needs_reply").toLowerCase();
    const validFilters = new Set(["needs_reply", "all", "unread"]);
    const filter = validFilters.has(filterParam) ? filterParam : "needs_reply";

    const limitParam = parseInt(url.searchParams.get("limit") || "100", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 100;

    // Pull most-recent conversations across the location.
    // GHL's search endpoint supports locationId + sortBy=last_message_date + sort=desc.
    const params = new URLSearchParams({
      locationId: GHL_LOCATION_ID,
      sortBy: "last_message_date",
      sort: "desc",
      limit: String(limit),
    });

    const searchRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/conversations/search?${params}`,
    );

    if (!searchRes.ok) {
      const body = await searchRes.text().catch(() => "");
      console.error(`[staff-conversations] Search error ${searchRes.status}: ${body}`);
      return new Response(
        JSON.stringify({ error: "Failed to load conversations" }),
        { status: 422, headers },
      );
    }

    const searchData = await searchRes.json();
    const rawConversations = searchData.conversations || searchData.data || [];

    // Normalize every conversation into a stable shape.
    // GHL's exact field names for direction vary, so we try several.
    const normalized = rawConversations.map((conv) => {
      const unreadCount = Number(conv.unreadCount || 0);

      // Try every plausible direction field GHL might use.
      const directionRaw =
        conv.lastMessageDirection ??
        conv.lastMessage?.direction ??
        conv.direction ??
        conv.lastOutboundMessageDirection ??
        null;
      const inbound = isInbound(directionRaw);
      const directionKnown = directionRaw !== null && directionRaw !== undefined;

      // GHL message types sometimes encode direction (e.g. "TYPE_SMS_INBOUND").
      const lastMessageType =
        conv.lastMessageType || conv.type || conv.lastMessage?.type || "";
      const typeIsInbound = /inbound/i.test(lastMessageType);
      const typeIsOutbound = /outbound/i.test(lastMessageType);

      // Final inbound determination — direction field wins, type tag is fallback.
      const lastIsInbound = directionKnown ? inbound : typeIsInbound;
      const lastIsOutbound = directionKnown ? !inbound : typeIsOutbound;

      const lastBody = conv.lastMessageBody || conv.lastMessage?.body || conv.lastMessage || "";
      const preview = typeof lastBody === "string" && lastBody.length > 140
        ? `${lastBody.slice(0, 140)}…`
        : (typeof lastBody === "string" ? lastBody : "");
      const rawDate =
        conv.lastMessageDate ||
        conv.lastMessage?.dateAdded ||
        conv.dateUpdated ||
        conv.dateAdded ||
        null;
      const lastMessageDate =
        typeof rawDate === "number"
          ? new Date(rawDate).toISOString()
          : rawDate || null;

      return {
        id: conv.id,
        contactId: conv.contactId || "",
        contactName: buildContactName(conv),
        email: conv.email || "",
        phone: conv.phone || "",
        lastMessagePreview: preview,
        lastMessageDate,
        lastMessageType: normalizeMessageType(lastMessageType),
        lastMessageDirection: lastIsInbound ? "inbound" : lastIsOutbound ? "outbound" : "unknown",
        unreadCount,
        // STRICT needs-reply: client's message must be the most recent one.
        // unreadCount alone is not enough — GHL's unreadCount semantics include
        // outbound-not-yet-seen in some cases, which would falsely flag sent messages.
        needsReply: lastIsInbound,
        assignedTo: conv.assignedTo || null,
      };
    });

    const filtered = normalized.filter((c) => {
      if (!c.contactId) return false;
      if (filter === "all") return true;
      if (filter === "unread") return c.unreadCount > 0;
      return c.needsReply; // strict: only client-last conversations
    });

    // Sort by most recent message first.
    const sorted = [...filtered].sort((a, b) => {
      const aTime = a.lastMessageDate ? new Date(a.lastMessageDate).getTime() : 0;
      const bTime = b.lastMessageDate ? new Date(b.lastMessageDate).getTime() : 0;
      return bTime - aTime;
    });

    // Debug mode: dump one raw conversation alongside the normalized list
    // so we can see what GHL actually returns and tune the parser.
    const debug = url.searchParams.get("debug") === "1";
    const responseBody = {
      filter,
      total: sorted.length,
      conversations: sorted,
      ...(debug && {
        debug: {
          rawSample: rawConversations[0] || null,
          rawCount: rawConversations.length,
          rawKeys: rawConversations[0] ? Object.keys(rawConversations[0]) : [],
        },
      }),
    };

    return new Response(JSON.stringify(responseBody), { status: 200, headers });
  } catch (err) {
    console.error("[staff-conversations] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers,
    });
  }
}
