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

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Active product allowlist — GHL productId → session bucket.
// Invoices with unknown productIds or retired product references are
// classified as "retired" and contribute 0 sessions.
export const ACTIVE_PRODUCTS = {
  "69987357c839790426996114": { type: "8-series", sessions: 8 },   // 8-Session Series
  "69986faa724ecd2343ebaa6e": { type: "4-series", sessions: 4 },   // 4-Session Series
  "699873d6990b71ebc1fa26b4": { type: "8-upgrade", sessions: 7 },  // Upgrade: Initial → 8-Session
  "6998739230cc6054f9bba62d": { type: "4-upgrade", sessions: 3 },  // Upgrade: Initial → 4-Session
  "688a1cd770362828afbf08a2": { type: "initial", sessions: 1 },    // Initial Session — In Person
  "690b6b4d333ffa59d40c1823": { type: "initial", sessions: 1 },    // Initial Session — Virtual
  "69aee204e80b62d627d8e922": { type: "followup", sessions: 1 },   // Follow-up Session — In Person
  "69aee3ebcf9cf8ed9f6c928d": { type: "followup", sessions: 1 },   // Follow-up Session — Virtual
  "6998ace59dfde469ecb2aab6": { type: "followup", sessions: 1 },   // Single Follow-up Session
  "67b1299f080422451447bdd0": { type: "followup", sessions: 1 },   // Pre Purchased session
  "69c5d29c4019ce8e80e2513b": { type: "entrainment", sessions: 0 }, // Entrainment — billed individually
  "6998d7f2606fa79c54fa3ff5": { type: "living-practice", sessions: 0 }, // Living Practice (video)
};

// Classification types that represent a series package purchase. Used to
// compute the "earliest active package purchase date" cutoff for attended
// sessions — appointments before this date predate the current prepaid
// balance and should not be counted against it.
const PACKAGE_TYPES = new Set(["4-series", "8-series", "4-upgrade", "8-upgrade"]);

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
  const name = (order.sourceName || "").toLowerCase();
  const sourceType = (order.sourceType || "").toLowerCase();

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
  // Real purchases go through sourceType="payment_link".
  if (sourceType === "calendar") {
    return { type: "placeholder", sessions: 0, name, amount };
  }

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
  return { type: "other", sessions: 0, name, amount };
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

  const purchased = classifications.reduce((sum, c) => sum + c.sessions, 0);
  const seriesType = determineSeriesType(classifications);

  // 2. Find the earliest active-package purchase date. Attended sessions
  // before this date pre-date the current prepaid balance (e.g., free
  // initials, old pay-as-you-go sessions, retired-product purchases)
  // and should NOT be counted against it. This handles the mid-series
  // repurchase case correctly because we use EARLIEST, not most recent —
  // both purchases land after the cutoff, so leftover sessions roll
  // into the new series.
  //
  // If the client has no package purchases (pay-as-you-go only), there's
  // no cutoff and all attended sessions count.
  const packageDates = classifications
    .filter((c) => PACKAGE_TYPES.has(c.type))
    .map((c) => c.date)
    .filter(Boolean)
    .sort();
  const cutoffDate = packageDates[0] || null;

  // 3. Filter appointments → only attended series sessions, on or after cutoff
  const attendedAllTime = appointments
    .filter((a) => SERIES_CALENDAR_IDS.has(a.calendarId))
    .filter((a) => {
      const status = (a.appointmentStatus || a.status || "").toLowerCase();
      return ATTENDED_STATUSES.has(status);
    });

  const attendedSeriesAppts = cutoffDate
    ? attendedAllTime.filter((a) => {
        const startTime = a.startTime || a.start_time || "";
        return startTime && startTime >= cutoffDate;
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
      orders = ordersData.data || ordersData.orders || [];
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
