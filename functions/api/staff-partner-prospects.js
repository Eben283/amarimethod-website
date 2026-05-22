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
const PARTNERSHIP_PIPELINE_ID = "wTHOvZQMdrrud4f7brTF";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

// Tags grouped by category. A category may include multiple tags (e.g. the
// historical `trainer-outreach` batch + the newer `trainer-new-partner` curation
// both count as "trainer" for filtering + category badge).
const CATEGORY_TAGS = {
  golf: ["golf-new-partner"],
  tennis: ["tennis-new-partner"],
  trainer: ["trainer-new-partner", "trainer-outreach"],
};

// Broad partner tags that don't imply a specific sport/practice category.
// Included in "all" so the universe covers everyone we've ever flagged as a
// potential partner (~300 unique across all tags after dedupe).
const BROAD_PARTNER_TAGS = ["partner-prospect", "affiliate-partner"];

// Full universe for category=all: every category tag plus broad tags.
const ALL_PARTNER_TAGS = [
  ...Object.values(CATEGORY_TAGS).flat(),
  ...BROAD_PARTNER_TAGS,
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
  // Most-specific first. Falls back to the historical `trainer-outreach`
  // tag so that legacy trainers still show "trainer" badge, not "unknown".
  if (CATEGORY_TAGS.golf.some((t) => tags.includes(t))) return "golf";
  if (CATEGORY_TAGS.tennis.some((t) => tags.includes(t))) return "tennis";
  if (CATEGORY_TAGS.trainer.some((t) => tags.includes(t))) return "trainer";
  return "unknown";
}

function toProspect(contact, stageInfo) {
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
    // Partnership Pipeline opp / stage — null if no opp exists yet for this contact.
    pipelineStageId: stageInfo?.stageId ?? null,
    pipelineStageName: stageInfo?.stageName ?? null,
    opportunityId: stageInfo?.opportunityId ?? null,
  };
}

// Fetch the Partnership Pipeline stage definitions + all opps in one call.
// Returns { stages: [{id, name, order}], byContactId: Map<contactId, {stageId, stageName, opportunityId}> }.
async function fetchPartnershipPipelineState(ghlToken) {
  // GHL requires locationId on /opportunities/pipelines or returns 422.
  const pipelinesRes = await fetch(
    `${GHL_API_BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`,
    { headers: ghlHeaders(ghlToken) },
  );
  if (!pipelinesRes.ok) {
    throw new Error(`GHL /opportunities/pipelines ${pipelinesRes.status}`);
  }
  const pipelinesData = await pipelinesRes.json();
  const pipeline = (pipelinesData.pipelines || []).find(
    (p) => p.id === PARTNERSHIP_PIPELINE_ID,
  );
  const stages = pipeline
    ? (pipeline.stages || []).map((s, i) => ({ id: s.id, name: s.name, order: i }))
    : [];
  const stageById = new Map(stages.map((s) => [s.id, s.name]));

  // Pull all opps in this pipeline. Page through if >100.
  const byContactId = new Map();
  let nextPath = `/opportunities/search?${new URLSearchParams({
    location_id: GHL_LOCATION_ID,
    pipeline_id: PARTNERSHIP_PIPELINE_ID,
    limit: "100",
  }).toString()}`;
  let safety = 0;
  while (nextPath && safety < 10) {
    const res = await fetch(`${GHL_API_BASE}${nextPath}`, {
      headers: ghlHeaders(ghlToken),
    });
    if (!res.ok) {
      throw new Error(`GHL /opportunities/search ${res.status}`);
    }
    const data = await res.json();
    for (const o of data.opportunities || []) {
      if (o.contactId || o.contact?.id) {
        const cid = o.contactId || o.contact.id;
        // Prefer most recently updated opp if a contact has multiple in this pipeline.
        const existing = byContactId.get(cid);
        if (!existing || new Date(o.updatedAt) > new Date(existing.updatedAt)) {
          byContactId.set(cid, {
            stageId: o.pipelineStageId,
            stageName: stageById.get(o.pipelineStageId) || "(unknown stage)",
            opportunityId: o.id,
            updatedAt: o.updatedAt,
          });
        }
      }
    }
    if (!data.meta?.nextPageUrl) break;
    const url = new URL(data.meta.nextPageUrl);
    nextPath = url.pathname.replace("/v1/", "/") + url.search;
    safety += 1;
  }

  return { stages, byContactId };
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
        : CATEGORY_TAGS[category] || [];

    if (tagsToFetch.length === 0) {
      return new Response(
        JSON.stringify({ error: `Unknown category: ${category}` }),
        { status: 400, headers },
      );
    }

    // Fetch contacts per tag + the partnership pipeline state in parallel.
    const [tagResults, pipelineState] = await Promise.all([
      Promise.all(tagsToFetch.map((tag) => fetchByTag(ghlToken, tag))),
      fetchPartnershipPipelineState(ghlToken),
    ]);

    // Dedupe contacts by id.
    const byId = new Map();
    for (const list of tagResults) {
      for (const c of list) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    }

    // Join: contact → stage info (may be null if contact has no opp in this pipeline).
    const prospects = Array.from(byId.values()).map((c) =>
      toProspect(c, pipelineState.byContactId.get(c.id) || null),
    );

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
        // Stages for kanban columns, in pipeline order. Includes a synthetic
        // "Unstaged" pseudo-stage at the front for contacts with no opp yet.
        stages: [
          { id: null, name: "Unstaged", order: -1 },
          ...pipelineState.stages,
        ],
        prospects,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Surface detail in the `error` field so the staff app's generic error UI
    // (which only displays `error`) reveals the real failure.
    console.error("[staff-partner-prospects] failed:", detail);
    return new Response(
      JSON.stringify({
        error: `Failed to load partner prospects: ${detail}`,
        detail,
      }),
      { status: 500, headers },
    );
  }
}
