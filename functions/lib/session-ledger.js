// Session ledger — single source of truth for prepaid session balances.
//
// Derives "purchased / attended / remaining" from GHL orders + appointments
// rather than trusting the sessions_remaining custom field. The custom field
// is read for comparison only and surfaces as a discrepancy ambiguity when
// it disagrees with the derived value.
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

  if (status !== "completed" || amount <= 0) {
    return { type: "ignored", sessions: 0, name, amount };
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
 * @param {object[]} params.orders        GHL orders array (from /payments/orders)
 * @param {object[]} params.appointments  GHL appointments array (from /contacts/{id}/appointments)
 * @param {object} params.fieldDefs       map of short key → custom field id
 * @returns ledger object — see staff-balances.js BalanceRow shape
 */
export function deriveLedger({ contact, orders = [], appointments = [], fieldDefs = {} }) {
  const ambiguities = [];

  // 1. Classify orders → derive purchased session count
  const classifications = orders.map(classifyOrder);
  const purchased = classifications.reduce((sum, c) => sum + c.sessions, 0);
  const seriesType = determineSeriesType(classifications);

  // 2. Filter appointments → only attended series sessions
  const attendedSeriesAppts = appointments
    .filter((a) => SERIES_CALENDAR_IDS.has(a.calendarId))
    .filter((a) => {
      const status = (a.appointmentStatus || a.status || "").toLowerCase();
      return ATTENDED_STATUSES.has(status);
    });

  const attended = attendedSeriesAppts.length;

  // 3. Compute remaining (floor at 0)
  let remaining = purchased - attended;
  if (remaining < 0) {
    ambiguities.push(
      `attended exceeds purchased (attended=${attended}, purchased=${purchased})`,
    );
    remaining = 0;
  }

  // 4. Last session date — most recent attended series session
  const lastSessionDate = attendedSeriesAppts
    .map((a) => a.startTime || a.start_time || null)
    .filter(Boolean)
    .sort()
    .pop() || null;

  // 5. Read overrides and compare to custom field
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

  // 6. If there's a manual prepaid override but no orders, we can't derive — flag it
  if (prepaidOverride && purchased === 0) {
    ambiguities.push(
      "manual prepaid override is set but no matching orders found — count is unknown",
    );
  }

  const confidence = ambiguities.length === 0 ? "high" : "low";
  const source = orders.length > 0 ? "orders+appointments" : "empty";

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
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
    ];
    if (!options.fieldDefs) {
      fetches.push(
        ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`),
      );
    }

    const [contactRes, ordersRes, apptRes, fieldDefsRes] = await Promise.all(fetches);

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

    return deriveLedger({ contact, orders, appointments, fieldDefs });
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
