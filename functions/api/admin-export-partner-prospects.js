// Read-only export: pulls partner-prospect contacts from GHL by tag and
// returns CSV. Tags covered: golf-new-partner, tennis-new-partner,
// trainer-new-partner. Visit the URL in a browser to download.
//
// DELETE THIS FILE after exporting — it's a one-shot tool.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const TAGS = ["golf-new-partner", "tennis-new-partner", "trainer-new-partner"];

// Fields to surface in the CSV. ghl returns customFields as an array of
// { id, value } objects; we flatten the known ones by key.
const CUSTOM_FIELD_KEYS = [
  "trainer_facility",
  "facility_role",
  "facility_type",
  "has_pt_on_staff",
];

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function fetchAllByTag(tag, token) {
  const out = [];
  let page = 1;
  const pageLimit = 100;
  while (true) {
    const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: ghlHeaders(token),
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        pageLimit,
        page,
        filters: [{ field: "tags", operator: "contains", value: tag }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Search failed for tag '${tag}' (page ${page}): ${res.status} ${errText}`);
    }
    const data = await res.json();
    const contacts = data.contacts || data.items || [];
    out.push(...contacts);
    if (contacts.length < pageLimit) break;
    page += 1;
    if (page > 30) break; // safety
  }
  return out;
}

function pickCustomField(contact, keyShortName, fieldDefs) {
  const id = fieldDefs[keyShortName];
  if (!id) return "";
  const cf = (contact.customFields || []).find(f => f.id === id);
  if (!cf) return "";
  if (typeof cf.value === "string") return cf.value;
  if (Array.isArray(cf.value)) return cf.value.join("; ");
  return cf.value != null ? String(cf.value) : "";
}

async function fetchFieldDefs(token) {
  const r = await fetch(`${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`, {
    headers: ghlHeaders(token),
  });
  if (!r.ok) return {};
  const data = await r.json();
  const defs = {};
  for (const f of data.customFields || []) {
    const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
    if (shortKey) defs[shortKey] = f.id;
  }
  return defs;
}

export async function onRequestGet(context) {
  const token = await getGhlToken(context);
  if (!token) {
    return new Response("no GHL token available", { status: 500 });
  }

  // Pull each tag in parallel
  const [defs, ...byTag] = await Promise.all([
    fetchFieldDefs(token),
    ...TAGS.map(tag => fetchAllByTag(tag, token)),
  ]);

  // Deduplicate by contact id, but keep all matching tags from our set
  const byId = new Map();
  TAGS.forEach((tag, i) => {
    for (const c of byTag[i]) {
      const existing = byId.get(c.id);
      if (existing) {
        existing.matchedTags.add(tag);
      } else {
        byId.set(c.id, { ...c, matchedTags: new Set([tag]) });
      }
    }
  });

  const rows = [...byId.values()];

  // Build CSV
  const headers = [
    "category", // primary tag of golf/tennis/trainer
    "firstName",
    "lastName",
    "email",
    "phone",
    "companyName",
    ...CUSTOM_FIELD_KEYS,
    "allTags",
    "contactId",
    "dateAdded",
  ];
  const lines = [headers.map(csvEscape).join(",")];

  for (const c of rows) {
    const matched = [...c.matchedTags];
    const category = matched.find(t => t.startsWith("golf")) ? "golf"
      : matched.find(t => t.startsWith("tennis")) ? "tennis"
      : "trainer";
    const cf = Object.fromEntries(
      CUSTOM_FIELD_KEYS.map(k => [k, pickCustomField(c, k, defs)])
    );
    lines.push([
      category,
      c.firstName || c.firstNameLowerCase || "",
      c.lastName || c.lastNameLowerCase || "",
      c.email || "",
      c.phone || "",
      c.companyName || "",
      ...CUSTOM_FIELD_KEYS.map(k => cf[k]),
      (c.tags || []).join("; "),
      c.id,
      c.dateAdded || "",
    ].map(csvEscape).join(","));
  }

  const csv = lines.join("\n");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="amari-partner-prospects-${new Date().toISOString().slice(0,10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
