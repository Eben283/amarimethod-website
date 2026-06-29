// Cloud port of detect-link-stalls.mjs.
// Takes (env, dueMap) in-memory instead of reading local files.

import { ghlPostRetry, LOCATION_ID } from "./ghl.js";

const LINK_STALL_DAYS = 3;

const PAYLINK_TAGS = {
  "paylink-sent-initial-in-person":    "Initial Session (in-person)",
  "paylink-sent-initial-virtual":      "Initial Session (virtual)",
  "paylink-sent-4-session-series":     "4-Session Series",
  "paylink-sent-8-session-series":     "8-Session Series",
  "paylink-sent-upgrade-initial-to-4": "Upgrade: Initial → 4-Session",
  "paylink-sent-upgrade-initial-to-8": "Upgrade: Initial → 8-Session",
  "paylink-sent-upgrade-4-to-8":       "Upgrade: 4-Session → 8-Session",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchByTag(env, tag) {
  const contacts = [];
  let page = 1;
  while (true) {
    const data = await ghlPostRetry(env, "/contacts/search", {
      locationId: LOCATION_ID,
      page,
      pageLimit: 100,
      filters: [{ field: "tags", operator: "contains", value: tag }],
    });
    const got = data.contacts || [];
    contacts.push(...got);
    if (got.length < 100) break;
    page++;
    if (page > 10) break;
  }
  return contacts;
}

// Returns Map<contactId, stallInfo>.
export async function detectLinkStalls(env, dueMap) {
  const stalls = new Map();

  for (const [tag, productName] of Object.entries(PAYLINK_TAGS)) {
    let contacts;
    try {
      contacts = await searchByTag(env, tag);
    } catch (e) {
      console.error(`[link-stalls] search failed for ${tag}: ${e.message?.slice(0, 80)}`);
      continue;
    }

    for (const c of contacts) {
      const id = c.id;
      if (stalls.has(id)) continue;
      const dueEntry = dueMap.get(id);
      if (!dueEntry) continue;
      if (dueEntry.sinceLastTouchDays < LINK_STALL_DAYS) continue;
      stalls.set(id, {
        contactId: id,
        name: dueEntry.name || c.contactName || c.fullName || id,
        product: productName,
        state: dueEntry.state,
        sinceLastTouchDays: Math.round(dueEntry.sinceLastTouchDays),
      });
    }

    await sleep(200);
  }

  console.error(`[link-stalls] detected ${stalls.size} link-sent stalls`);
  return stalls;
}
