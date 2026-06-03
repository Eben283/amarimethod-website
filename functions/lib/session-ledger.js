// Session ledger — single source of truth for prepaid session balances.
//
// Derives "purchased / attended / remaining" from GHL orders + invoices +
// appointments rather than trusting the sessions_remaining custom field.
// The custom field is read for comparison only and surfaces as a discrepancy
// ambiguity when it disagrees with the derived value.
//
// Used by:
//   functions/api/staff-balances.js  — global prepaid ledger view
//   functions/api/staff-data.js      — today's appointments enrichment
//   functions/api/staff-contact.js   — single contact detail
//
// Pure derivation lives in deriveLedger() (no I/O — fully unit-testable).
// computeSessionLedger() is the I/O wrapper that fetches data from GHL.

import { ghlFetch } from "./ghl.js";
import { getCustomField } from "../api/portal-data.js";
import { LEDGER_PRODUCT_MAP, PACKAGE_TYPES } from "./ghl-products.js";
import { hydrateOrders as hydrateOrdersShared } from "./ghl-orders.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

/**
 * hydrateOrders — Pages-side wrapper around the transport-agnostic
 * `hydrateOrders` in ghl-orders.js. Binds a context-aware order-detail
 * fetcher (via ghlFetch) so callers in functions/api/* can just pass
 * (context, ordersList).
 *
 * The hydration LOGIC (skip when items present, concurrency limit, mark
 * failures) lives in the shared helper so the series-reconcile-worker
 * can use the exact same behavior. See ghl-orders.js for full rationale.
 */
export async function hydrateOrders(context, ordersList) {
  return hydrateOrdersShared(async (orderId) => {
    const res = await ghlFetch(
      context,
      `${GHL_API_BASE}/payments/orders/${orderId}?altId=${GHL_LOCATION_ID}&altType=location`,
    );
    if (!res.ok) throw new Error(`GHL detail status ${res.status}`);
    return res.json();
  }, ordersList);
}

// Re-export as ACTIVE_PRODUCTS for backward compatibility with tests.
// Source of truth is ghl-products.js → GHL_PRODUCTS. To add a new product,
// edit that file only — both the ledger and the invoice webhook pick it up.
export const ACTIVE_PRODUCTS = LEDGER_PRODUCT_MAP;

// Calendar IDs that count against a series. Source: ghl_calendars_source_of_truth.md
// 2 initial calendars + 4 follow-up calendars. Anything not in this set
// does NOT decrement a series balance.
export const SERIES_CALENDAR_IDS = new Set([
  "G7OAnnJuFbMF6nQSlZVQ", // Initial Session — In Person
  "ySmht5hx4uZGEpgZrlCw", // Initial Session — Virtual
  "SKDVOL8wtUN6Ne0ppbC9", // Follow-up Session — In Person
  "ZO1jlGfy01rsxVqicoSB", // Follow-up Session — In Person (Package)
  "bJFkhVP35Ecwh4tLnSmy", // Follow-up Session — Virtual (Package)
  "oVn77FcecFY16iS2pHyP", // Follow-up Session — Virtual
]);

// Calendars that are explicitly NOT against series. Kept for documentation;
// SERIES_CALENDAR_IDS is the actual filter (anything not in it is excluded).
export const NON_SERIES_CALENDAR_IDS = new Set([
  "B5aGXLoS4kzAjZAMMXxk", // Entrainment (billed individually, not via series)
  "USgPsktqRcuomdUgpShL", // Your Free Discovery Call
  "ZEIGFHBi17SpZ3Ezi5DR", // Discovery Call - Virtual
  "aVE54Qf4lrbYTB0zFqXy", // Ambassador Prospect Discovery Call
  "lfsnaiGiLNL2z12pLKDP", // Partner Initial Session (free perk for partners)
  "uUDFD0ZQEWtzGLS9aLq7", // Initial Session — Paid at Partner (partner POS, no order in GHL)
]);

const ATTENDED_STATUSES = new Set(["showed", "completed"]);

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Classify a single GHL order into a session bucket.
 * Returns { type, sessions } where sessions = how many series slots it adds.
 */
export function classifyOrder(order) {
  const status = (order.status || "").toLowerCase();
  const amount = Number(order.amount || 0);
  const sourceName = (order.sourceName || "").toLowerCase();
  const sourceType = (order.sourceType || order.source?.type || "").toLowerCase();
  // POS (mobile_app) orders carry product info in items[0] but a blank/odd
  // sourceName — must fall through to productId-based classification below.
  const firstItem = (order.items || [])[0] || {};
  const itemProductId = firstItem.product?._id || firstItem.productId || null;
  const itemName = (firstItem.product?.name || firstItem.name || "").toLowerCase();
  const name = sourceName || itemName;
  const hydrationFailed = order.__hydration_failed === true;

  if (status !== "completed" || amount <= 0) {
    return { type: "ignored", sessions: 0, name, amount };
  }

  // Booking-generated placeholder orders. GHL auto-creates a "completed" order
  // for every booking on a calendar with Accept Payments enabled — even when the
  // client has already paid via a prepaid series. These orders have
  // sourceType="calendar" and paymentStatus="partially_paid" ($0 actually
  // collected), and need manual reconciliation per project_order_reconciliation.md.
  // Counting them as new purchases double-counts the series: each follow-up
  // booking would inflate `purchased` by 1 while the appointment also decrements
  // via `attended`, so `remaining` never drops.
  // Real purchases go through sourceType="payment_link" or sourceType="point_of_sale".
  if (sourceType === "calendar") {
    return { type: "placeholder", sessions: 0, name, amount };
  }

  // Primary classifier: productId lookup against ACTIVE_PRODUCTS (same as
  // classifyInvoice). Real purchases always carry a productId — sourceName
  // is often blank for POS/mobile_app orders so name-pattern matching alone
  // misses Justin/Jenn-style in-studio sales (the 2026-05-29 bug fix).
  if (itemProductId && ACTIVE_PRODUCTS[itemProductId]) {
    const entry = ACTIVE_PRODUCTS[itemProductId];
    return { type: entry.type, sessions: entry.sessions, name, amount };
  }

  // Fallback: name-pattern matching (payment_link orders where sourceName
  // carries the package title and no productId lookup hit).
  // Check upgrade BEFORE series — "Upgrade to 4-Session" must not match 4-series.
  if (/upgrade/i.test(name)) {
    // $1,070 = upgrade to 8-session (adds 7 to existing 1 initial)
    // $495   = upgrade to 4-session (adds 3 to existing 1 initial)
    if (amount >= 1000) return { type: "8-upgrade", sessions: 7, name, amount };
    return { type: "4-upgrade", sessions: 3, name, amount };
  }
  if (/8.?session|eight.?session/i.test(name)) {
    return { type: "8-series", sessions: 8, name, amount };
  }
  if (/4.?session|four.?session/i.test(name)) {
    return { type: "4-series", sessions: 4, name, amount };
  }
  if (/entrainment/i.test(name)) {
    return { type: "entrainment", sessions: 0, name, amount };
  }
  if (/initial/i.test(name)) {
    return { type: "initial", sessions: 1, name, amount };
  }
  if (/follow.?up/i.test(name)) {
    return { type: "followup", sessions: 1, name, amount };
  }
  // Fell through every classifier with no match. If the order was supposed
  // to be hydrated but the detail fetch failed, surface that — otherwise
  // deriveLedger would treat this as a confident "other" and the worker
  // might write a derived zero over a correct field. The flag travels in
  // the classification so deriveLedger can fold it into ambiguities.
  return {
    type: "other",
    sessions: 0,
    name,
    amount,
    hydrationFailed,
    hydrationReason: hydrationFailed ? order.__hydration_reason : undefined,
  };
}

/**
 * Classify a single GHL invoice into a session bucket.
 * Invoices live at a separate endpoint from orders (/invoices/), have a
 * different shape (invoiceItems[] + productId), and are the primary source
 * of truth for real purchases that go through GHL's invoicing flow
 * (e.g., the $1,295 8-Session Series). Payment-link purchases still flow
 * through /payments/orders and are classified by classifyOrder().
 *
 * Rules:
 * - Only count status="paid" + amountPaid > 0. Drafts, sent, viewed, void,
 *   and partially-paid invoices contribute 0 — no real money moved yet.
 * - Primary classifier: productId lookup against ACTIVE_PRODUCTS. This is
 *   the only reliable signal because invoice.name is usually "New Invoice"
 *   on every row (GHL default), and invoiceItems[0].name varies by
 *   product-creation era.
 * - Unknown productId (retired product, custom item with no productId) →
 *   classify as "retired" → 0 sessions. All of Danny Blumrich's old per-
 *   session invoices are retired products — they shouldn't inflate his
 *   current balance.
 */
export function classifyInvoice(invoice) {
  const status = (invoice.status || "").toLowerCase();
  const amountPaid = Number(invoice.amountPaid || 0);
  const items = invoice.invoiceItems || [];
  const firstItem = items[0] || {};
  const name = (firstItem.name || invoice.name || "").toLowerCase();
  const date = invoice.issueDate || invoice.updatedAt || invoice.createdAt || null;

  if (status !== "paid" || amountPaid <= 0) {
    return { type: "ignored", sessions: 0, name, amount: amountPaid, date: null };
  }

  const productId = firstItem.productId || null;
  if (productId && ACTIVE_PRODUCTS[productId]) {
    const entry = ACTIVE_PRODUCTS[productId];
    return { type: entry.type, sessions: entry.sessions, name, amount: amountPaid, date };
  }

  // Unknown productId (retired product, deleted product, or custom item
  // with no productId) — do not count toward balance. The user's product
  // catalog is the source of truth; anything outside ACTIVE_PRODUCTS is
  // historical and already reconciled.
  return { type: "retired", sessions: 0, name, amount: amountPaid, date };
}

function determineSeriesType(classifications) {
  // Most authoritative: explicit series purchases.
  const has8 = classifications.some((c) => c.type === "8-series" || c.type === "8-upgrade");
  if (has8) return "8-session";
  const has4 = classifications.some((c) => c.type === "4-series" || c.type === "4-upgrade");
  if (has4) return "4-session";
  // Individual purchases without a series upgrade.
  const hasIndividual = classifications.some(
    (c) => c.type === "initial" || c.type === "followup",
  );
  if (hasIndividual) return "Single";
  return "none";
}

function getCustomFieldInt(contact, key, fieldDefs) {
  const raw = getCustomField(contact, key, fieldDefs);
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Pure derivation ─────────────────────────────────────────────────────────

/**
 * deriveLedger — pure function. No I/O. Fully unit-testable.
 *
 * @param {object} params
 * @param {object} params.contact         GHL contact object (with customFields)
 * @param {object[]} params.orders        GHL orders (from /payments/orders)
 * @param {object[]} params.invoices      GHL invoices (from /invoices/)
 * @param {object[]} params.appointments  GHL appointments (from /contacts/{id}/appointments)
 * @param {object} params.fieldDefs       map of short key → custom field id
 * @returns ledger object — see staff-balances.js BalanceRow shape
 */
export function deriveLedger({
  contact,
  orders = [],
  invoices = [],
  appointments = [],
  fieldDefs = {},
}) {
  const ambiguities = [];

  // 1. Classify orders + invoices → derive purchased session count.
  // Each classification carries a date so we can compute a cutoff for
  // attended sessions (see step 2). Orders use createdAt; invoices use
  // issueDate. Classifications without dates are still summed into
  // purchased, they just don't contribute to the cutoff.
  const orderClassifications = orders.map((o) => ({
    ...classifyOrder(o),
    date: o.createdAt || o.updatedAt || null,
  }));
  const invoiceClassifications = invoices.map(classifyInvoice);
  const classifications = [...orderClassifications, ...invoiceClassifications];

  // Surface hydration failures as ambiguities. classifyOrder returns
  // hydrationFailed=true when an order had no items[] and the caller
  // (hydrateOrders) couldn't fetch detail to fill it in. That means the
  // classifier had to guess — and a confident "other" / 0 sessions on a
  // package-sized completed order would silently zero out a correct
  // sessions_remaining field. By pushing an ambiguity here, confidence
  // drops to "low" and the worker's existing low-confidence-skip guard
  // (sync.js:258) prevents the destructive write.
  for (const c of orderClassifications) {
    if (c.hydrationFailed) {
      ambiguities.push(
        `order hydration failed (${c.hydrationReason || "unknown"}); classification may be incomplete`,
      );
    }
  }

  const purchasedFromClassifications = classifications.reduce(
    (sum, c) => sum + c.sessions,
    0,
  );
  const seriesType = determineSeriesType(classifications);

  // Upgrade orders (4-upgrade +3, 8-upgrade +7) already account for the
  // initial session correctly: the client paid $225 for the initial, then
  // paid the upgrade difference ($495 or $1,070). The upgrade gives them
  // 3 or 7 ADDITIONAL sessions on top of the 1 they already used. Whether
  // or not a separate "initial" order exists in the system doesn't change
  // the purchased count — the upgrade math is self-contained.
  //
  // The attended side counts the initial appointment via SERIES_CALENDAR_IDS
  // (which includes initial calendars), but that appointment was the session
  // they used before upgrading — it's already "consumed" and the upgrade
  // sessions start after it.
  const purchased = purchasedFromClassifications;

  // 2. Find the earliest active-package purchase DAY (YYYY-MM-DD). Attended
  // sessions before this day pre-date the current prepaid balance (e.g.,
  // free initials, old pay-as-you-go sessions, retired-product purchases)
  // and should NOT be counted against it. This handles the mid-series
  // repurchase case correctly because we use EARLIEST, not most recent —
  // both purchases land after the cutoff, so leftover sessions roll
  // into the new series.
  //
  // Comparison is day-granularity (YYYY-MM-DD), not timestamp, because
  // Garrett sometimes books a session, sells a package during the session,
  // and applies that session to the new package. Example: Danny 2026-03-18 —
  // free session at ~11am, buys 8-pack at ~11:44am, session counts as 1/8.
  // With timestamp-level cutoff the session would fall on the wrong side
  // by a few hours. Day-level comparison matches human intent.
  //
  // If the client has no package purchases (pay-as-you-go only), there's
  // no cutoff and all attended sessions count.
  const toDay = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "");
  const packageDates = classifications
    .filter((c) => PACKAGE_TYPES.has(c.type))
    .map((c) => c.date)
    .filter(Boolean)
    .sort();
  const cutoffDay = toDay(packageDates[0] || "");

  // 3. Filter appointments → only attended series sessions, on or after cutoff day
  const attendedAllTime = appointments
    .filter((a) => SERIES_CALENDAR_IDS.has(a.calendarId))
    .filter((a) => {
      const status = (a.appointmentStatus || a.status || "").toLowerCase();
      return ATTENDED_STATUSES.has(status);
    });

  const attendedSeriesAppts = cutoffDay
    ? attendedAllTime.filter((a) => {
        const startDay = toDay(a.startTime || a.start_time || "");
        return startDay && startDay >= cutoffDay;
      })
    : attendedAllTime;

  const attended = attendedSeriesAppts.length;

  // 4. Compute remaining (floor at 0)
  let remaining = purchased - attended;
  if (remaining < 0) {
    ambiguities.push(
      `attended exceeds purchased (attended=${attended}, purchased=${purchased})`,
    );
    remaining = 0;
  }

  // 5. Last session date — most recent attended series session (any time,
  // not filtered by cutoff, so we show the real last visit)
  const lastSessionDate = attendedAllTime
    .map((a) => a.startTime || a.start_time || null)
    .filter(Boolean)
    .sort()
    .pop() || null;

  // 6. Read overrides and compare to custom field
  const prepaidOverride =
    (getCustomField(contact, "session_prepaid", fieldDefs) || "").toLowerCase() === "yes";

  // Manual lock — when true, session counts are intentionally human-managed
  // and the series-reconcile-worker won't auto-sync them. Surface here so
  // any consumer of the ledger can show "locked" status (e.g. staff app
  // could render a small lock icon next to the count, portal could note
  // "your count is being manually managed").
  const lockedRaw = getCustomField(contact, "sessions_remaining_locked", fieldDefs);
  const manualLock = Array.isArray(lockedRaw)
    ? lockedRaw.includes("true")
    : (lockedRaw === "true" || lockedRaw === true);

  const customFieldRemaining = getCustomFieldInt(contact, "sessions_remaining", fieldDefs);
  if (
    customFieldRemaining !== null &&
    customFieldRemaining !== remaining &&
    purchased > 0
  ) {
    ambiguities.push(
      `custom field sessions_remaining=${customFieldRemaining} disagrees with derived=${remaining}`,
    );
  }

  // 7. If there's a manual prepaid override but no orders, we can't derive — flag it
  if (prepaidOverride && purchased === 0) {
    ambiguities.push(
      "manual prepaid override is set but no matching orders found — count is unknown",
    );
  }

  const confidence = ambiguities.length === 0 ? "high" : "low";
  const hasSources = orders.length > 0 || invoices.length > 0;
  const source = hasSources ? "orders+invoices+appointments" : "empty";

  return {
    seriesType,
    purchased,
    attended,
    manualLock,
    remaining,
    lastSessionDate,
    prepaidOverride,
    source,
    confidence,
    ambiguities,
  };
}

// ── I/O wrapper ─────────────────────────────────────────────────────────────

/**
 * computeSessionLedger — fetches GHL data for a single contact and derives
 * the ledger. Used by staff-balances.js (which auto-imports this module).
 *
 * @param {object} context     Cloudflare Pages function context
 * @param {string} contactId   GHL contact id
 * @param {object} options
 * @param {object} options.fieldDefs   pre-fetched field defs map (avoids extra GHL call)
 */
export async function computeSessionLedger(context, contactId, options = {}) {
  if (!contactId) {
    return {
      seriesType: "none",
      purchased: 0,
      attended: 0,
      remaining: 0,
      lastSessionDate: null,
      prepaidOverride: false,
      source: "empty",
      confidence: "low",
      ambiguities: ["no contactId provided"],
    };
  }

  let fieldDefs = options.fieldDefs || {};

  try {
    const fetches = [
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
      ghlFetch(
        context,
        `${GHL_API_BASE}/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`,
      ),
      // GHL's /invoices/ list endpoint requires offset as a non-empty string
      // or it returns 422. Always pass offset=0 for the first page.
      ghlFetch(
        context,
        `${GHL_API_BASE}/invoices/?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`,
      ),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
    ];
    if (!options.fieldDefs) {
      fetches.push(
        ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`),
      );
    }

    const [contactRes, ordersRes, invoicesRes, apptRes, fieldDefsRes] =
      await Promise.all(fetches);

    if (!contactRes.ok) {
      return {
        seriesType: "none",
        purchased: 0,
        attended: 0,
        remaining: 0,
        lastSessionDate: null,
        prepaidOverride: false,
        source: "empty",
        confidence: "low",
        ambiguities: [`failed to fetch contact (${contactRes.status})`],
      };
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact || {};

    let orders = [];
    if (ordersRes.ok) {
      const ordersData = await ordersRes.json();
      const ordersList = ordersData.data || ordersData.orders || [];
      orders = await hydrateOrders(context, ordersList);
    }

    let invoices = [];
    if (invoicesRes.ok) {
      const invoicesData = await invoicesRes.json();
      invoices = invoicesData.invoices || [];
    }

    let appointments = [];
    if (apptRes.ok) {
      const apptData = await apptRes.json();
      appointments = apptData.appointments || apptData.events || [];
    }

    if (!options.fieldDefs && fieldDefsRes && fieldDefsRes.ok) {
      const data = await fieldDefsRes.json();
      const map = {};
      for (const f of data.customFields || []) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) map[shortKey] = f.id;
      }
      fieldDefs = map;
    }

    return deriveLedger({ contact, orders, invoices, appointments, fieldDefs });
  } catch (err) {
    return {
      seriesType: "none",
      purchased: 0,
      attended: 0,
      remaining: 0,
      lastSessionDate: null,
      prepaidOverride: false,
      source: "empty",
      confidence: "low",
      ambiguities: [`ledger error: ${err.message}`],
    };
  }
}
