// Cloudflare Pages Function: GET /api/staff-partner-prospects
//
// Returns partner prospects (golf / tennis / trainer) for the Partners tab.
// Reads the 8 partner_* custom fields created 2026-05-23 (see
// TECHNICAL-REFERENCE.txt § "GHL CUSTOM FIELDS (partner outreach)").
//
// Always returns the full universe (no category filtering on the backend);
// frontend filters client-side for instant chip interaction.
//
// Auth: JWT bearer, same pattern as other staff endpoints.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import sheetCache from "../lib/partner-sheet-cache.json";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

// Custom field IDs used by the Partners tab.
// New partner_* fields created 2026-05-23.
// Existing facility fields are in the "Trainer Outreach" group — already in use; we read but don't duplicate.
// See ops/ref/partner-custom-fields-2026-05-22.json for full registry.
const FIELD_IDS = {
  // New (state / signal tracking)
  partner_stage:           "KfPow1mYDxJqiOCS6mDZ",
  partner_source:          "wFYnPOmI6PzllGGuCWvs",
  partner_last_signal:     "XyUoMtbxadTuZunQwX3Y",
  partner_last_signal_at:  "J0lnfsvtt0vcFOdSbUSf",
  partner_followup_at:     "stVYzQB4Xpi29cuyUYnA",
  // Real last-activity date (populated by backfill script — see ops/scripts/...
  // GHL's contact.lastActivity is null for most contacts; this field caches
  // the most recent message date computed from /conversations/search.)
  partner_last_real_activity: "W7JoyJKPKhPI8hZ5EgUv",
  // Existing (facility context)
  trainer_facility:        "eYBj61zgMnIFMIesoDR5",
  facility_type:           "gIQEMkO1gV85SAYcYlNx",
  facility_role:           "FGakk9CgiRqeY0tleGQD",
  has_pt_on_staff:         "YWglhoiMeTUPSpHA9322",
  outreach_verified:       "PVftrxrmNRPmfdlQAwzl",
};

// Tags that identify partner contacts. Union across categories + broad tags.
const CATEGORY_TAGS = {
  golf:    ["golf-new-partner"],
  tennis:  ["tennis-new-partner"],
  trainer: ["trainer-new-partner", "trainer-outreach"],
};
// `ambassador-prospect` added 2026-05-23 after migration missed Troy Weakley
// (his only tag was ambassador-prospect, so he was excluded entirely).
const BROAD_PARTNER_TAGS = ["partner-prospect", "affiliate-partner", "ambassador-prospect"];
const ALL_PARTNER_TAGS = [
  ...Object.values(CATEGORY_TAGS).flat(),
  ...BROAD_PARTNER_TAGS,
];

const ALL_STAGES = [
  "no-outreach",
  "working",
  "session-booked",
  "partner",
  "future-potential",
  "dropped",
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

function deriveCategory(tags) {
  if (!Array.isArray(tags)) return "unknown";
  if (CATEGORY_TAGS.golf.some((t) => tags.includes(t))) return "golf";
  if (CATEGORY_TAGS.tennis.some((t) => tags.includes(t))) return "tennis";
  if (CATEGORY_TAGS.trainer.some((t) => tags.includes(t))) return "trainer";
  return "unknown";
}

// GHL stores custom fields as an array of {id, value} on the contact.
// Read a single field by ID; returns null if not set.
function getField(contact, fieldId) {
  if (!Array.isArray(contact.customFields)) return null;
  const f = contact.customFields.find((cf) => cf.id === fieldId);
  if (!f) return null;
  const v = f.value ?? f.field_value;
  if (v === "" || v === null || v === undefined) return null;
  return v;
}

// "Outreach Verified" is a CHECKBOX. GHL returns either true, "true", or ["true"].
function isChecked(raw) {
  if (raw === null || raw === undefined) return false;
  if (Array.isArray(raw)) return raw.some((v) => ["true", "yes", "1"].includes(String(v).toLowerCase()));
  return ["true", "yes", "1"].includes(String(raw).toLowerCase());
}

function normalizePhone(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  if (d.length === 10 && /^[2-9]/.test(d)) return d;
  return null;
}

// Lookup Garrett's sheet row for a contact by phone or email match.
function lookupSheetRow(contact) {
  const phoneNorm = normalizePhone(contact.phone);
  if (phoneNorm && sheetCache.byPhone[phoneNorm]) return sheetCache.byPhone[phoneNorm];
  const emailNorm = contact.email ? contact.email.toLowerCase() : null;
  if (emailNorm && sheetCache.byEmail[emailNorm]) return sheetCache.byEmail[emailNorm];
  return null;
}

function toProspect(contact) {
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const sheetRow = lookupSheetRow(contact);
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
    website: contact.website || null,
    instagram: null,  // GHL has no native IG field; left blank until enrichment adds it
    // Prefer the cached real activity date (populated by backfill script from
    // /conversations messages). Falls back to GHL's contact.lastActivity (usually
    // null), and finally to null → "not recorded" in the UI.
    // We deliberately do NOT fall back to dateUpdated — that reflects when our
    // own writes happen (e.g., the migration) and is misleading.
    lastActivityAt:
      getField(contact, FIELD_IDS.partner_last_real_activity) ||
      contact.lastActivity ||
      null,
    isActivePartner: tags.includes("affiliate-partner"),
    // New partner custom fields — null if not yet migrated.
    partnerStage:         getField(contact, FIELD_IDS.partner_stage),
    partnerSource:        getField(contact, FIELD_IDS.partner_source),
    partnerLastSignal:    getField(contact, FIELD_IDS.partner_last_signal),
    partnerLastSignalAt:  getField(contact, FIELD_IDS.partner_last_signal_at),
    partnerFollowupAt:    getField(contact, FIELD_IDS.partner_followup_at),
    // Existing facility / context fields (Trainer Outreach group).
    partnerFacility:      getField(contact, FIELD_IDS.trainer_facility),
    partnerFacilityType:  getField(contact, FIELD_IDS.facility_type),
    partnerFacilityRole:  getField(contact, FIELD_IDS.facility_role),
    hasPtOnStaff:         getField(contact, FIELD_IDS.has_pt_on_staff),
    outreachVerified:     isChecked(getField(contact, FIELD_IDS.outreach_verified)),
    // Sheet data joined by phone/email match — primary source for verified contacts.
    sheetStatus:          sheetRow?.status || null,
    sheetNotes:           sheetRow?.notes || null,
    sheetInstagram:       sheetRow?.instagram || null,
    inGarrettSheet:       !!sheetRow,
  };
}

async function fetchByTag(ghlToken, tag, pageLimit = 100) {
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
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
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
    if (pageOffset >= 500) break;
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

    // Fetch contacts for every partner tag in parallel, then dedupe by id.
    const tagResults = await Promise.all(
      ALL_PARTNER_TAGS.map((tag) => fetchByTag(ghlToken, tag)),
    );
    const byId = new Map();
    for (const list of tagResults) {
      for (const c of list) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    }
    const prospects = Array.from(byId.values()).map(toProspect);

    // Counts.
    // A contact counts as "verified / ready to call" if either:
    //   (a) Outreach Verified checkbox is true (manual confirm), OR
    //   (b) the contact is in Garrett's SF Personal Trainers sheet
    //       (sheet inclusion = his curation, the whole point of joining the sheet).
    // This matches the user intent: "view this is confirmed enriched data good to call".
    const countsByCategory = { golf: 0, tennis: 0, trainer: 0, unknown: 0 };
    const countsByStage = Object.fromEntries(ALL_STAGES.map((s) => [s, 0]));
    let verifiedCount = 0;
    let unverifiedCount = 0;
    for (const p of prospects) {
      countsByCategory[p.category] = (countsByCategory[p.category] || 0) + 1;
      const stage = p.partnerStage || "no-outreach";
      countsByStage[stage] = (countsByStage[stage] || 0) + 1;
      const isReady = p.outreachVerified || p.inGarrettSheet;
      if (isReady) verifiedCount += 1;
      else unverifiedCount += 1;
    }

    return new Response(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        sheetCachedAt: sheetCache.generatedAt,
        total: prospects.length,
        verifiedCount,
        unverifiedCount,
        countsByCategory,
        countsByStage,
        prospects,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
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
