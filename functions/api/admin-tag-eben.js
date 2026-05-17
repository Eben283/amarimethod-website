// One-shot admin endpoint — adds affiliate-partner tag to Eben's contact.
// Hardcoded to a single email so worst-case discovery is harmless.
// DELETE THIS FILE after use.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const TARGET_EMAIL = "eben@ebenforrest.com";
const TARGET_TAG = "affiliate-partner";

export async function onRequestGet(context) {
  const token = await getGhlToken(context);
  if (!token) return json({ error: "no token" }, 500);

  // Find ALL contacts with this email (catch duplicates)
  const found = [];

  // Strategy 1: duplicate search
  try {
    const r = await fetch(
      `${GHL_API_BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(TARGET_EMAIL)}`,
      { headers: ghlHeaders(token) }
    );
    if (r.ok) {
      const d = await r.json();
      if (d.contact?.id) found.push(d.contact);
      if (Array.isArray(d.contacts)) found.push(...d.contacts);
    }
  } catch (_) {}

  // Strategy 2: contacts list query
  try {
    const r = await fetch(
      `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(TARGET_EMAIL)}&limit=20`,
      { headers: ghlHeaders(token) }
    );
    if (r.ok) {
      const d = await r.json();
      const matches = (d.contacts || []).filter(
        (c) => (c.email || "").toLowerCase() === TARGET_EMAIL
      );
      found.push(...matches);
    }
  } catch (_) {}

  // Dedupe by id
  const byId = new Map();
  for (const c of found) if (c?.id) byId.set(c.id, c);
  const contacts = [...byId.values()];

  if (contacts.length === 0) return json({ error: "no contact found", email: TARGET_EMAIL }, 404);

  // Tag every match
  const results = [];
  for (const c of contacts) {
    const before = c.tags || [];
    let after = before;
    let action = "already had tag";

    if (!before.includes(TARGET_TAG)) {
      const r = await fetch(`${GHL_API_BASE}/contacts/${c.id}/tags`, {
        method: "POST",
        headers: ghlHeaders(token),
        body: JSON.stringify({ tags: [TARGET_TAG] }),
      });
      if (r.ok) {
        const d = await r.json();
        after = d.tags || [...before, TARGET_TAG];
        action = "added";
      } else {
        action = `failed: ${r.status} ${await r.text()}`;
      }
    }

    results.push({ id: c.id, name: `${c.firstName || ""} ${c.lastName || ""}`.trim(), before, after, action });
  }

  return json({ ok: true, target_email: TARGET_EMAIL, target_tag: TARGET_TAG, count: contacts.length, results });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
