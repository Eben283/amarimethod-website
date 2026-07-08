// GHL API helpers for series-reconcile-worker.
// Tokens managed in PORTAL_KV by ghl-token-refresh worker. Token plumbing
// itself lives in the shared functions/lib/ghl-worker-token.js (2026-07-01 —
// this file used to carry its own byte-identical copy, same as 6 other
// Workers; found + extracted during the cron-job architecture audit).

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../../functions/lib/ghl-fields.js";

export { getAccessToken };

const GHL_BASE = "https://services.leadconnectorhq.com";

export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

async function ghlRequest(env, method, path, body) {
  const token = await getAccessToken(env);
  const url = `${GHL_BASE}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
  };
  if (body !== undefined) opts.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL ${method} ${path} ${res.status}: ${errText.slice(0, 250)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export const ghlGet = (env, path) => ghlRequest(env, "GET", path);
export const ghlPost = (env, path, body) => ghlRequest(env, "POST", path, body);
export const ghlPut = (env, path, body) => ghlRequest(env, "PUT", path, body);

// ── Domain helpers ──

// List completed orders updated since `sinceMs`. GHL's /payments/orders endpoint
// accepts no date filter, so we page and select in code.
//
// SORT ORDER (verified empirically 2026-06-11 against live data): GHL returns these
// sorted by `createdAt` DESCENDING — NOT `updatedAt`, which the prior version assumed
// when it early-broke on the first order older than the cutoff. That assumption is
// unsound: because `updatedAt >= createdAt` always, a late-paid order (old createdAt,
// recent updatedAt) sits DEEP in a createdAt-desc list, PAST the point where the scan
// would already have broken — so it was silently skipped, the exact orphan class this
// worker exists to catch. We therefore do NOT date-break on the non-sort key. Instead
// we scan all completed orders up to MAX_PAGES and select any updated in window. This
// stays cheap: the caller's per-order getOrderDetail work is gated to the selected
// (in-window) orders, so only the list pages grow, and they terminate naturally at the
// last (short) page — ceil(totalOrders/PAGE) fetches in steady state (~3 today). If the
// order history ever exceeds the cap we warn rather than silently truncate.
export async function listRecentCompletedOrders(env, sinceMs) {
  const orders = [];
  let offset = 0;
  const PAGE = 50;
  const MAX_PAGES = 6; // 300-order scan ceiling
  let hitCap = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const data = await ghlGet(
      env,
      `/payments/orders?altId=${LOCATION_ID}&altType=location&status=completed&limit=${PAGE}&offset=${offset}`
    );
    const batch = data.data || [];
    if (batch.length === 0) break;
    for (const o of batch) {
      const t = new Date(o.updatedAt || o.createdAt).getTime();
      if (Number.isFinite(t) && t >= sinceMs) orders.push(o);
    }
    if (batch.length < PAGE) break; // reached the end of the order history
    offset += PAGE;
    if (p === MAX_PAGES - 1) hitCap = true; // full page at the cap → more orders remain unscanned
  }
  if (hitCap) {
    console.warn(
      `[series-reconcile] listRecentCompletedOrders hit the ${MAX_PAGES * PAGE}-order scan cap; ` +
      `older completed orders are unscanned this run. Raise MAX_PAGES in ghl.js.`
    );
  }
  return orders;
}

export async function getOrderDetail(env, orderId) {
  return ghlGet(env, `/payments/orders/${orderId}?altId=${LOCATION_ID}&altType=location`);
}

export async function getContact(env, contactId) {
  const data = await ghlGet(env, `/contacts/${contactId}`);
  return data.contact;
}

// PATCH a contact's custom fields + (optional) tags.
export async function patchContact(env, contactId, customFields, tags) {
  const body = { customFields };
  if (Array.isArray(tags)) body.tags = tags;
  return ghlPut(env, `/contacts/${contactId}`, body);
}

// Remove specific tags from a contact WITHOUT replacing its tag array.
// patchContact's `tags` arg does a wholesale PUT replace, which clobbers tags a
// concurrent GHL workflow set (and GHL triggers are tag-driven). The dedicated
// DELETE /contacts/{id}/tags endpoint mutates only the named tags; removing an
// absent tag is a harmless no-op, so this is safe to retry.
export async function removeContactTags(env, contactId, tags) {
  const list = [...new Set(tags || [])].filter(Boolean);
  if (!list.length) return { removed: [] };
  await ghlRequest(env, "DELETE", `/contacts/${contactId}/tags`, { tags: list });
  return { removed: list };
}

export async function addContactNote(env, contactId, body) {
  return ghlPost(env, `/contacts/${contactId}/notes`, { body });
}

// Field IDs used to identify a contact who could hold a session balance.
const SWEEP_FIELD = {
  series_type: GHL_FIELD_IDS.series_type,
  sessions_remaining: GHL_FIELD_IDS.sessions_remaining,
  session_prepaid: GHL_FIELD_IDS.session_prepaid,
};

// Enumerate every contact who could hold a session balance — active series,
// sessions_remaining > 0, or session_prepaid = "yes". Paginates /contacts/search
// and filters in code, mirroring daily-audit-worker's proven drift-scan query
// (daily-audit-worker/src/index.js ~676). These are the field-sync sweep
// candidates — the set the old orders-window sync missed for mid-package clients.
// Cost: up to PAGE_CAP page fetches; only paid on a queue rebuild (~once/22h).
export async function fetchActiveSeriesContactIds(env) {
  const ids = [];
  const PAGE_CAP = 10; // 1000 contacts (matches daily-audit)
  let hitCap = false;
  for (let page = 1; page <= PAGE_CAP; page++) {
    const data = await ghlPost(env, "/contacts/search", {
      locationId: LOCATION_ID,
      pageLimit: 100,
      page,
    });
    const contacts = data.contacts || [];
    if (contacts.length === 0) break;
    for (const c of contacts) {
      const cf = c.customFields || [];
      const seriesType = cf.find((f) => f.id === SWEEP_FIELD.series_type)?.value || "none";
      const remaining = parseInt(cf.find((f) => f.id === SWEEP_FIELD.sessions_remaining)?.value ?? "0", 10) || 0;
      const prepaid = (cf.find((f) => f.id === SWEEP_FIELD.session_prepaid)?.value || "").toString().toLowerCase() === "yes";
      if (seriesType !== "none" || remaining > 0 || prepaid) ids.push(c.id);
    }
    if (contacts.length < 100) break;
    if (page === PAGE_CAP) hitCap = true; // full page AT the cap → more contacts remain
  }
  // Surface the cap so we widen the scan as the contact base grows past 1000,
  // instead of silently dropping active-series contacts from the sweep queue.
  // daily-audit-worker has the twin scan with the same warning.
  if (hitCap) {
    console.warn(
      `[series-reconcile] fetchActiveSeriesContactIds hit the ${PAGE_CAP * 100}-contact ` +
      `pagination cap; active-series contacts past that are unqueued this rebuild. ` +
      `Raise PAGE_CAP in ghl.js.`
    );
  }
  return ids;
}
