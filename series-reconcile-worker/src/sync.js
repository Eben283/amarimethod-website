// Continuous field sync — keeps GHL `sessions_remaining` and `sessions_completed`
// custom fields aligned with the ledger-derived values.
//
// Why this exists: even after the order-reconciliation pass (reconcile.js)
// runs, the GHL fields can drift over time — late-cancel debits, manual edits,
// workflow misfires. Rather than fighting each drift cause individually, this
// sync hour-by-hour pulls the field back to ledger truth.
//
// Guards (per the SESSION-FIELDS-AUDIT.md plan, 2026-05-29):
//   - Only writes when ledger.confidence === 'high'
//   - Only writes when the new value differs from the current value
//   - Skips contacts whose field was touched < 5 min ago (manual edit window)
//
// Imports deriveLedger from the Pages Functions lib so the math stays a
// single source of truth. Wrangler bundles transitively.

import { deriveLedger } from "../../functions/lib/session-ledger.js";
import { ghlGet, ghlPut, getOrderDetail, LOCATION_ID } from "./ghl.js";

const FIELD_IDS = {
  series_type: "3i93lTkmuAV49s9nh0q8",
  sessions_completed: "TE0udwVH1Km5RsKaN5H0",
  sessions_remaining: "wrQSkx6BhXwDGIn1d0V4",
  // Manual override lock. When checked, the worker skips this contact —
  // neither sessions_remaining nor sessions_completed get auto-corrected.
  // Used for one-off cases where derivation disagrees with intent (e.g.
  // Garrett comped a session, custom credit, etc.). staff-mark-attended.js
  // still decrements on real attendance — the lock only blocks automated
  // sync, not user-initiated events. Field created 2026-05-29 (Albert Yang
  // case). See SESSION-FIELDS-AUDIT.md.
  sessions_remaining_locked: "oDyLqIeq3yTkyhgXhAmk",
};

// Lifetime journey patterns. Mirrors NON_JOURNEY_PATTERNS in
// functions/api/staff-mark-attended.js (2026-05-29 contract).
// Past appointments excluded from the lifetime counter:
//   - Discovery / consultation calls (pre-session phone chats — not bodywork)
//   - Pain assessment (quiz/intake — not bodywork)
//   - 15-minute appointments (discovery variant)
// Entrainments AND Partner Initial sessions DO count: per Eben's 2026-05-29
// briefing the lifetime number is "real bodywork the client has done",
// regardless of how it was billed (entrainment = $90 separate, partner-init
// = comp). The package math (sessions_remaining) is what tracks billing.
const NON_JOURNEY_PATTERNS = /pain assessment|discovery call|15-minute|15 minute|consultation/i;
const LIFETIME_STATUSES = new Set(["completed", "showed", "confirmed"]);

const MANUAL_EDIT_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const KV_LAST_SYNC_PREFIX = "field-sync:lastSynced:"; // + contactId
const KV_NEEDS_REVIEW_PREFIX = "field-sync:needsReview:"; // + contactId
// If the derived value differs from the current value by more than this on
// either field, do NOT auto-apply. Write to KV "needs review" instead so a
// human can verify before correction. Per Eben's 2026-05-29 directive on
// Danny Blumrich: don't auto-fix large drifts without checking.
const MAX_AUTO_DELTA = 2;

function readField(contact, fieldId) {
  const cf = (contact.customFields || []).find((x) => x.id === fieldId);
  if (!cf) return null;
  return cf.value ?? cf.field_value;
}

function readFieldInt(contact, fieldId) {
  const raw = readField(contact, fieldId);
  if (raw === null || raw === undefined || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// Lifetime count = past appointments that effectively ran (showed/completed/
// or PAST confirmed), minus the non-journey types. Mirrors the portal's
// ProgressTracker logic and the new staff-mark-attended.js contract.
// Future-confirmed appointments are excluded — they haven't happened yet
// even though their status is "confirmed."
function computeLifetimeCount(appointments) {
  const nowMs = Date.now();
  return appointments.filter((a) => {
    const status = (a.appointmentStatus || a.status || "").toLowerCase();
    if (!LIFETIME_STATUSES.has(status)) return false;
    const startMs = new Date(a.startTime || a.start_time || 0).getTime();
    // Past-only — drop future confirmed.
    if (!Number.isFinite(startMs) || startMs >= nowMs) return false;
    const title = (a.title || "") + " " + (a.calendarName || "");
    return !NON_JOURNEY_PATTERNS.test(title);
  }).length;
}

// Package size lookup. Keep in sync with the values written by
// reconcile.js when an order is detected. "none" means no series → 0.
const PACKAGE_SIZE = { "8-session": 8, "4-session": 4, "none": 0 };

/**
 * Read-only contact-counts lookup. Returns ledger-derived session truth
 * without any writes. Used by /day morning briefing to get authoritative
 * counts per contact in one call (instead of pulling raw GHL fields and
 * trying to interpret them).
 *
 * Returns:
 *   {
 *     status: "ok" | "low-confidence" | "errored",
 *     contactId, contactName,
 *     seriesType: "8-session" | "4-session" | "none",
 *     packageSize: 8 | 4 | 0,
 *     sessionsRemaining: int,        // ledger truth — package balance
 *     sessionsCompleted: int,        // lifetime visits (per 5/29 contract)
 *     pkgCompleted: int,             // packageSize - sessionsRemaining (0 if no pack)
 *     locked: bool,                  // sessions_remaining_locked = true
 *     ledgerConfidence: string,      // "high" | "low" | etc.
 *     ambiguities: string[],         // present when confidence < high
 *     rawFields: { sessions_remaining, sessions_completed },  // for sanity
 *   }
 */
export async function getContactCounts(env, contactId, fieldDefs = {}) {
  try {
    const [contactRes, ordersRes, invoicesRes, apptRes] = await Promise.all([
      ghlGet(env, `/contacts/${contactId}`),
      ghlGet(env, `/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`),
      ghlGet(env, `/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`),
      ghlGet(env, `/contacts/${contactId}/appointments`),
    ]);

    const contact = contactRes.contact || {};
    const ordersList = ordersRes.data || ordersRes.orders || [];
    const invoices = invoicesRes.invoices || [];
    const appointments = apptRes.appointments || apptRes.events || [];

    // Hydrate items[] for POS/mobile_app orders (same trick syncFieldsForContact uses).
    const orders = await Promise.all(
      ordersList.map(async (o) => {
        try { return await getOrderDetail(env, o._id); } catch { return o; }
      })
    );

    const lockedRaw = readField(contact, FIELD_IDS.sessions_remaining_locked);
    const isLocked = Array.isArray(lockedRaw) ? lockedRaw.includes("true") : (lockedRaw === "true" || lockedRaw === true);

    const ledger = deriveLedger({ contact, orders, invoices, appointments, fieldDefs });
    const lifetimeCount = computeLifetimeCount(appointments);

    const seriesRaw = readField(contact, FIELD_IDS.series_type);
    const seriesType = (seriesRaw && (seriesRaw === "8-session" || seriesRaw === "4-session")) ? seriesRaw : "none";
    const packageSize = PACKAGE_SIZE[seriesType] || 0;

    // sessionsRemaining: if locked, prefer the manually-pinned GHL field
    // value (worker would skip overwriting it). Otherwise use ledger truth.
    const fieldRemaining = readFieldInt(contact, FIELD_IDS.sessions_remaining);
    const sessionsRemaining = isLocked
      ? (fieldRemaining ?? 0)
      : (ledger.confidence === "high" ? ledger.remaining : (fieldRemaining ?? 0));

    const pkgCompleted = packageSize > 0 ? Math.max(0, packageSize - sessionsRemaining) : 0;

    return {
      status: ledger.confidence === "high" || isLocked ? "ok" : "low-confidence",
      contactId,
      contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
      seriesType,
      packageSize,
      sessionsRemaining,
      sessionsCompleted: lifetimeCount,
      pkgCompleted,
      locked: isLocked,
      ledgerConfidence: ledger.confidence,
      ambiguities: ledger.ambiguities || [],
      rawFields: {
        sessions_remaining: fieldRemaining,
        sessions_completed: readFieldInt(contact, FIELD_IDS.sessions_completed),
      },
    };
  } catch (err) {
    return {
      status: "errored",
      contactId,
      error: String(err.message || err).slice(0, 300),
    };
  }
}

/**
 * Sync one contact's session fields to ledger-derived values.
 * Returns { status, ...details }:
 *   - "skipped-recent-edit" — field touched < 5 min ago
 *   - "skipped-low-confidence" — ledger doesn't have high confidence
 *   - "skipped-already-in-sync" — derived === current for both fields
 *   - "synced" — writes happened, includes before/after
 *   - "errored" — fetch or PUT failed
 */
export async function syncFieldsForContact(env, contactId, fieldDefs = {}) {
  try {
    // Fetch contact + orders + invoices + appointments in parallel.
    const [contactRes, ordersRes, invoicesRes, apptRes] = await Promise.all([
      ghlGet(env, `/contacts/${contactId}`),
      ghlGet(env, `/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`),
      ghlGet(env, `/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`),
      ghlGet(env, `/contacts/${contactId}/appointments`),
    ]);

    const contact = contactRes.contact || {};
    const ordersList = ordersRes.data || ordersRes.orders || [];
    const invoices = invoicesRes.invoices || [];
    const appointments = apptRes.appointments || apptRes.events || [];

    // GHL's /payments/orders LIST endpoint returns summary records WITHOUT
    // items[] — productId is only on the detail endpoint. classifyOrder needs
    // items[0].product._id to recognize POS/mobile_app purchases (where
    // sourceName is empty). Fetch detail for each order. Cost: N extra
    // subrequests per contact, where N = order count (typically 1-5).
    const orders = await Promise.all(
      ordersList.map(async (o) => {
        try {
          return await getOrderDetail(env, o._id);
        } catch {
          return o; // fall back to summary record — classifyOrder may still match by name
        }
      })
    );

    // Hard lock: skip the worker entirely if `sessions_remaining_locked` is
    // true. Used for cases where Garrett's intent disagrees with the ledger
    // derivation (one-off comps, manual credits, etc.). staff-mark-attended.js
    // still decrements on real attendance — the lock only blocks automated
    // drift correction, not user-initiated events. See SESSION-FIELDS-AUDIT.md.
    const lockedRaw = readField(contact, FIELD_IDS.sessions_remaining_locked);
    const isLocked = Array.isArray(lockedRaw) ? lockedRaw.includes("true") : (lockedRaw === "true" || lockedRaw === true);
    if (isLocked) {
      return {
        status: "skipped-locked",
        contactId,
        contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
        currentFields: {
          sessions_remaining: readFieldInt(contact, FIELD_IDS.sessions_remaining),
          sessions_completed: readFieldInt(contact, FIELD_IDS.sessions_completed),
        },
      };
    }

    // Manual-edit debounce: if the contact was updated recently, skip — a
    // human might have just typed the value in, and we don't want to clobber
    // them within the same minute.
    const contactUpdatedAt = contact.dateUpdated || contact.updatedAt;
    if (contactUpdatedAt) {
      const updatedMs = new Date(contactUpdatedAt).getTime();
      if (Number.isFinite(updatedMs) && Date.now() - updatedMs < MANUAL_EDIT_DEBOUNCE_MS) {
        return {
          status: "skipped-recent-edit",
          contactId,
          contactUpdatedAt,
          ageMs: Date.now() - updatedMs,
        };
      }
    }

    // Derive the ledger.
    const ledger = deriveLedger({ contact, orders, invoices, appointments, fieldDefs });

    // Skip when confidence is low — likely an ambiguity that needs human
    // review (e.g. derived attended > purchased). Don't overwrite a manual
    // fix with a derivation we already know is uncertain.
    if (ledger.confidence !== "high") {
      return {
        status: "skipped-low-confidence",
        contactId,
        ledger: { remaining: ledger.remaining, purchased: ledger.purchased, attended: ledger.attended, ambiguities: ledger.ambiguities },
      };
    }

    // Compute the lifetime count (separate from ledger.attended which is
    // package-only and gated by SERIES_CALENDAR_IDS + cutoff).
    const lifetimeCount = computeLifetimeCount(appointments);

    // What the fields currently say.
    const currentRemaining = readFieldInt(contact, FIELD_IDS.sessions_remaining);
    const currentCompleted = readFieldInt(contact, FIELD_IDS.sessions_completed);

    const remainingMatches = currentRemaining === ledger.remaining;
    // For sessions_completed, only write when derived value is GREATER than
    // or equal to current. Never decrement — Garrett may have manually
    // bumped the count, and we want lifetime to be monotonically increasing.
    const completedMatches = currentCompleted !== null && currentCompleted >= lifetimeCount;

    if (remainingMatches && completedMatches) {
      return {
        status: "skipped-already-in-sync",
        contactId,
        ledger: { remaining: ledger.remaining, lifetimeCount },
        current: { sessions_remaining: currentRemaining, sessions_completed: currentCompleted },
      };
    }

    // ── Delta guard ──
    // Don't auto-apply large drifts. The guard threshold (MAX_AUTO_DELTA) is
    // there because a big disagreement between derived and current usually
    // means the ledger derivation is missing context OR the human bumped
    // for a reason we don't see (e.g. comp session, manual reconciliation,
    // historical data the orders endpoint can't reach).
    const remainingDelta = !remainingMatches ? Math.abs(ledger.remaining - (currentRemaining ?? 0)) : 0;
    const newCompletedTarget = currentCompleted !== null
      ? Math.max(currentCompleted, lifetimeCount)
      : lifetimeCount;
    const completedDelta = !completedMatches ? Math.abs(newCompletedTarget - (currentCompleted ?? 0)) : 0;

    if (remainingDelta > MAX_AUTO_DELTA || completedDelta > MAX_AUTO_DELTA) {
      // Don't write — flag for human review.
      await env.PORTAL_KV.put(
        KV_NEEDS_REVIEW_PREFIX + contactId,
        JSON.stringify({
          at: new Date().toISOString(),
          contactId,
          contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
          current: { sessions_remaining: currentRemaining, sessions_completed: currentCompleted },
          derived: { sessions_remaining: ledger.remaining, sessions_completed: newCompletedTarget },
          delta: { sessions_remaining: remainingDelta, sessions_completed: completedDelta },
          ledger: { purchased: ledger.purchased, attended: ledger.attended, lifetimeCount },
        }),
        { expirationTtl: 30 * 86400 },
      );
      return {
        status: "skipped-large-delta-flagged-for-review",
        contactId,
        contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
        current: { sessions_remaining: currentRemaining, sessions_completed: currentCompleted },
        derived: { sessions_remaining: ledger.remaining, sessions_completed: newCompletedTarget },
        delta: { sessions_remaining: remainingDelta, sessions_completed: completedDelta },
      };
    }

    // Build the patch. Only include fields that actually changed.
    const customFields = [];
    if (!remainingMatches) {
      customFields.push({ id: FIELD_IDS.sessions_remaining, value: ledger.remaining });
    }
    if (!completedMatches) {
      customFields.push({ id: FIELD_IDS.sessions_completed, value: newCompletedTarget });
    }

    if (customFields.length === 0) {
      return { status: "skipped-already-in-sync", contactId };
    }

    await ghlPut(env, `/contacts/${contactId}`, { customFields });

    // Track when we last synced this contact in KV (for visibility + future
    // debounce-on-our-own-writes if needed).
    const kvKey = KV_LAST_SYNC_PREFIX + contactId;
    await env.PORTAL_KV.put(
      kvKey,
      JSON.stringify({ at: new Date().toISOString(), wrote: customFields.map((f) => f.id) }),
      { expirationTtl: 14 * 86400 },
    );

    return {
      status: "synced",
      contactId,
      contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
      before: { sessions_remaining: currentRemaining, sessions_completed: currentCompleted },
      after: {
        sessions_remaining: !remainingMatches ? ledger.remaining : currentRemaining,
        sessions_completed: !completedMatches ? newCompletedTarget : currentCompleted,
      },
      ledger: { purchased: ledger.purchased, attended: ledger.attended, lifetimeCount },
    };
  } catch (err) {
    return {
      status: "errored",
      contactId,
      error: String(err.message || err).slice(0, 300),
    };
  }
}

/**
 * Collect the unique contactIds whose orders fall in the lookback window.
 * Each of those contacts is a candidate for field sync.
 */
export function uniqueContactIdsFromOrders(orders) {
  const set = new Set();
  for (const o of orders) {
    if (o.contactId) set.add(o.contactId);
  }
  return [...set];
}

/**
 * Iterate over a list of contactIds and sync each, respecting a hard budget
 * on subrequests (Cloudflare Workers limit: 50 free, 1000 paid). Each sync
 * costs ~5 subrequests (4 fetches + 1 PUT). Cap at MAX_PER_RUN to leave
 * headroom for the order pass and other work in the same invocation.
 */
export async function syncContacts(env, contactIds, fieldDefs, options = {}) {
  const MAX_PER_RUN = options.maxPerRun || 25;
  const results = [];
  for (const contactId of contactIds.slice(0, MAX_PER_RUN)) {
    const r = await syncFieldsForContact(env, contactId, fieldDefs);
    results.push(r);
  }
  return {
    contactsScanned: Math.min(contactIds.length, MAX_PER_RUN),
    contactsRemaining: Math.max(0, contactIds.length - MAX_PER_RUN),
    results,
  };
}
