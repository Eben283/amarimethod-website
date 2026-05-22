// Cloudflare Pages Function: GET /api/staff-partner-prospects
// Returns partner prospects (golf / tennis / trainer / generic partner-prospect)
// for the new Partners tab in the staff app.
//
// Query params:
//   ?category=all|golf|tennis|trainer  (default: all)
//
// Reads contacts directly from GHL via tag filter. No KV cache (v0).
//
// Auth: same JWT pattern as other staff endpoints.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

// Tag → category mapping. Order matters: most-specific first.
const CATEGORY_TAGS = {
  golf: "golf-new-partner",
  tennis: "tennis-new-partner",
  trainer: "trainer-new-partner",
};

// For "all" we union three tags. (We deliberately exclude the very-broad
// `trainer-outreach` cohort of 237 in v0 — it's the historical email push,
// not the curated daily-call universe.)
const ALL_PARTNER_TAGS = [
  CATEGORY_TAGS.golf,
  CATEGORY_TAGS.tennis,
  CATEGORY_TAGS.trainer,
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

function deriveCategory(tags) {
  if (!Array.isArray(tags)) return "unknown";
  if (tags.includes(CATEGORY_TAGS.golf)) return "golf";
  if (tags.includes(CATEGORY_TAGS.tennis)) return "tennis";
  if (tags.includes(CATEGORY_TAGS.trainer)) return "trainer";
  return "unknown";
}

function toProspect(contact) {
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  return {
    contactId: contact.id,
    firstName: contact.firstName || "",
    lastName: contact.lastName || "",
    fullName:
      contact.contactName ||
      [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
      "(no name)",
    category: deriveCategory(tags),
    tags,
    phone: contact.phone || null,
    email: contact.email || null,
    // `lastActivity` is GHL's roll-up of most recent contact event.
    // Some contacts have it; older imports may not.
    lastActivityAt:
      contact.lastActivity ||
      contact.dateUpdated ||
      null,
    isActivePartner: tags.includes("affiliate-partner"),
  };
}

async function fetchByTag(ghlToken, tag, pageLimit = 100) {
  // GHL /contacts/search with tag filter. Paginates if >pageLimit.
  const all = [];
  let pageOffset = 0;
  while (true) {
    const body = {
      locationId: GHL_LOCATION_ID,
      pageLimit,
      page: Math.floor(pageOffset / pageLimit) + 1,
      filters: [{ field: "tags", operator: "contains", value: tag }],
    };
    const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: {
        ...ghlHeaders(ghlToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GHL contacts/search ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const contacts = data.contacts || [];
    all.push(...contacts);
    if (contacts.length < pageLimit) break;
    pageOffset += pageLimit;
    if (pageOffset >= 500) break; // safety
  }
  return all;
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
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers },
      );
    }

    // Auth — same pattern as other staff endpoints.
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers },
      );
    }
    try {
      await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Session expired. Please log in again." }),
        { status: 401, headers },
      );
    }

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) {
      return new Response(
        JSON.stringify({ error: "GHL not configured" }),
        { status: 500, headers },
      );
    }

    // Resolve which tags to fetch based on category param.
    const url = new URL(context.request.url);
    const category = (url.searchParams.get("category") || "all").toLowerCase();
    const tagsToFetch =
      category === "all"
        ? ALL_PARTNER_TAGS
        : CATEGORY_TAGS[category]
          ? [CATEGORY_TAGS[category]]
          : [];

    if (tagsToFetch.length === 0) {
      return new Response(
        JSON.stringify({ error: `Unknown category: ${category}` }),
        { status: 400, headers },
      );
    }

    // Fetch contacts per tag in parallel, then dedupe by contactId.
    const tagResults = await Promise.all(
      tagsToFetch.map((tag) => fetchByTag(ghlToken, tag)),
    );
    const byId = new Map();
    for (const list of tagResults) {
      for (const c of list) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    }
    const prospects = Array.from(byId.values()).map(toProspect);

    // Sort: never-touched first (oldest activity = highest priority for a call),
    // then by activity date ascending (oldest touched next).
    prospects.sort((a, b) => {
      if (!a.lastActivityAt && !b.lastActivityAt) return 0;
      if (!a.lastActivityAt) return -1;
      if (!b.lastActivityAt) return 1;
      return new Date(a.lastActivityAt).getTime() - new Date(b.lastActivityAt).getTime();
    });

    const countsByCategory = prospects.reduce(
      (acc, p) => {
        acc[p.category] = (acc[p.category] || 0) + 1;
        return acc;
      },
      { golf: 0, tennis: 0, trainer: 0, unknown: 0 },
    );

    return new Response(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        total: prospects.length,
        countsByCategory,
        prospects,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Failed to load partner prospects",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers },
    );
  }
}
