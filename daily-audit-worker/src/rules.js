// Audit rule sets — ported from qa-audit.js for Cloudflare Worker environment.
// Each function takes { env, cache, appointments, auditStart, auditEnd } and returns issues[].

import { ghlFetch, fetchAppointmentsForDate, LOCATION_ID } from "./ghl.js";
import { AUDIT_INCREMENT_MAP } from "../../functions/lib/ghl-products.js";

// ── Product mapping ──
// Derived from the single source of truth (functions/lib/ghl-products.js →
// AUDIT_INCREMENT_MAP), keyed by BOTH productIds and priceIds (current AND
// historical). Replaces a hand-typed map that carried STALE price IDs and was
// missing the 4→8 upgrade — both of which left this watchdog blind to real
// purchases. Semantics unchanged: "after this purchase, sessions_remaining
// should be >= increment".
const PRODUCT_MAP = AUDIT_INCREMENT_MAP;

// ── Paginated order fetch ──
// GHL's /payments/orders caps at limit=100 per page. The location-wide scans below
// pull the full order list and then filter it to a time window, so a single 100-row
// page silently drops in-window orders once the practice has >100 total orders — a
// false "clean" in the very safety net meant to catch missed credits. Walk offset
// pages until a short (final) page or a hard cap, and report whether the cap was hit
// so the caller surfaces a warning instead of going quietly blind. Steady state
// (<100 total orders) still costs exactly one request.
const ORDER_PAGE_LIMIT = 100;
const ORDER_PAGE_CAP = 10; // 1000 orders — well under the worker's 1000-subrequest budget

async function fetchAllOrders(env) {
  const orders = [];
  for (let page = 0; page < ORDER_PAGE_CAP; page++) {
    const offset = page * ORDER_PAGE_LIMIT;
    const data = await ghlFetch(
      env,
      `/payments/orders?altId=${LOCATION_ID}&altType=location&limit=${ORDER_PAGE_LIMIT}&offset=${offset}`
    );
    const batch = data.orders || data.data || [];
    orders.push(...batch);
    if (batch.length < ORDER_PAGE_LIMIT) return { orders, hitCap: false };
  }
  return { orders, hitCap: true }; // a full final page → more orders may exist beyond the cap
}

const ORDER_CAP_MSG = `Hit the ${ORDER_PAGE_CAP * ORDER_PAGE_LIMIT}-order pagination cap — orders beyond it were not inspected`;

// Resolve the audited package/product for an order. (R3 fix, 2026-06-08.)
// GHL line items carry the product id NESTED at `item.product._id` (= productId)
// and `item.price._id` (= priceId). The flat `item.productId` / `item.priceId`
// fields are ABSENT on real orders — so the prior
// `items[0]?.priceId || items[0]?.productId || order.productId` read came back
// undefined and the audit `continue`d past EVERY order, silently blind to all
// package purchases (it could report "clean" on a genuinely broken purchase).
// This scans ALL line items (not just items[0], so a package at index 1+ isn't
// missed) and reads the nested ids. PRODUCT_MAP is keyed by BOTH productId and
// priceId, so either resolves.
export function findAuditedProduct(order) {
  const items = order?.items || order?.lineItems || [];
  for (const item of items) {
    const id = item?.product?._id || item?.price?._id;
    const config = id ? PRODUCT_MAP[id] : null;
    if (config) return config;
  }
  return null;
}

// Classify a GHL INVOICE's line items into an audited package, reusing findAuditedProduct.
// Asymmetry (verified 2026-06-11): order items nest the ids (`item.product._id`) while
// invoice items carry them FLAT (`item.productId` / `item.priceId`) — so we adapt the
// shape. PRODUCT_MAP is keyed by both productId and priceId, so either resolves. Returns
// the same config findAuditedProduct does, or null. Pure + exported for tests. Why it
// exists: invoice-billed packages (e.g. Betsy's $1,295 8-pack) are ABSENT from
// /payments/orders, so order-only scans can't see them — this lets the audit classify them.
export function classifyInvoiceItems(items = []) {
  const adapted = (items || []).map((i) => ({ product: { _id: i.productId }, price: { _id: i.priceId } }));
  return findAuditedProduct({ items: adapted });
}

// Threshold for the unmapped-purchase alert. Set just below the cheapest package
// (the $495 Initial→4 upgrade / $720 4-pack) but above every à-la-carte item
// (initial $225, follow-up $190, entrainment $90, Living Practice $347) — so a
// PAID order at/above this that maps to NO known product is almost certainly a
// package product added in GHL but missing from the catalog (the Jenn POS
// failure class), not a benign single-session no-op.
const UNMAPPED_ALERT_MIN_AMOUNT = 400;

// Pure: a paid order this size that resolves to no audited product is worth a
// human look — it likely means a paid client was silently NOT credited because a
// product is missing from functions/lib/ghl-products.js. Only PAID orders count;
// pending/failed ones are ignored.
export function isUnmappedHighValueOrder(order) {
  const amount = Number(order?.amount ?? order?.total ?? 0);
  if (!Number.isFinite(amount) || amount < UNMAPPED_ALERT_MIN_AMOUNT) return false;
  const status = String(order?.status ?? order?.paymentStatus ?? "").toLowerCase();
  return status === "paid" || status === "completed" || status === "succeeded";
}

// How many sessions a client can plausibly draw down within the audit window
// (AUDIT_HOURS = 48). The session right before a package purchase is draw #1 of
// that pack (the documented package-session-counting rule — Garrett runs the
// session, then sells/charges the pack right after), so a freshly-purchased
// package legitimately reads 1-2 below its increment within the window. Without
// this, every sold-then-attended-same-day purchase fired a false CRITICAL,
// training the operator to ignore the alert that matters.
const REMAINING_WINDOW_TOLERANCE = 2;

// Pure: does post-purchase sessions_remaining indicate a GENUINE under-credit,
// after allowing for sessions plausibly drawn within the audit window? A missing
// or unparseable field after a recognized purchase is a real failure (true). For
// an à-la-carte single (increment 1) the tolerance makes buy-then-attend-to-0 a
// non-event, which is correct — a +1 ADD can't be re-verified from the snapshot
// once it has been drawn. Exported for unit tests.
export function remainingIndicatesUndercredit(rawRemaining, increment, windowTolerance = REMAINING_WINDOW_TOLERANCE) {
  const remaining = parseInt(rawRemaining, 10);
  if (isNaN(remaining)) return true;
  return remaining < increment - windowTolerance;
}

const UPSELL_PATTERNS = [
  { seriesType: "8-session", keywords: ["upgrade", "8-session", "8 session", "8-pack", "eight session"] },
  { seriesType: "4-session", keywords: ["4-session", "4 session", "4-pack", "four session"] },
];

function issue(severity, category, contactId, contactName, rule, expected, actual, suggestion) {
  return { severity, category, contactId, contactName, rule, expected, actual, suggestion };
}

// Client Initial Session calendars — the ones that fire the G2 "Initial Session
// Welcome" post-session flow. We detect the initial session DIRECTLY by calendar.
// (Was previously inferred from the `sessions_completed` field — which is actually
// labeled "Sessions Lifetime" and counts comps + FUTURE bookings, so a first-timer
// who'd already booked their next session read >1 and got silently skipped.
// Fixed 2026-06-12.) Excludes "Partner Initial Session" (gifted partner-prospect
// session — its own flow, handled by the partner_session_verify check below).
export const INITIAL_SESSION_CALENDAR_IDS = new Set([
  "G7OAnnJuFbMF6nQSlZVQ", // Initial Session — In Person
  "ySmht5hx4uZGEpgZrlCw", // Initial Session — Virtual
  "uUDFD0ZQEWtzGLS9aLq7", // Initial Session — Paid at Partner
]);

export function isClientInitialSession(appt) {
  if (appt?.calendarId && INITIAL_SESSION_CALENDAR_IDS.has(appt.calendarId)) return true;
  // Fallback by calendar name: client initials are "Initial Session — …".
  // "Partner Initial Session" starts with "Partner", so it is NOT matched.
  return /^\s*initial session\b/i.test(appt?.calendarName || "");
}

// ── Rule Set 1: Appointment-triggered automations ──

export async function auditAppointments({ cache, appointments }) {
  const issues = [];
  const now = new Date();

  for (const appt of appointments) {
    if (!appt.contactId) continue;

    const cached = await cache.getContact(appt.contactId);
    if (!cached) {
      issues.push(issue(
        "warning", "appointment", appt.contactId, "Unknown",
        "contact_fetch_failed",
        "Contact data should be accessible",
        `Could not fetch contact ${appt.contactId}`,
        "Check if contact was deleted or merged"
      ));
      continue;
    }

    const { name, tags, fields } = cached;
    const apptEnd = new Date(appt.endTime);

    // Status still "confirmed" after appointment ended
    if (appt.appointmentStatus === "confirmed" && apptEnd < now) {
      issues.push(issue(
        "warning", "appointment", appt.contactId, name,
        "status_not_updated",
        "Status should change to 'showed' or 'no_show' after session ends",
        `Still "confirmed" (ended ${apptEnd.toISOString()})`,
        "Garrett may not have marked attendance"
      ));
    }

    // Status "showed" — verify the post-session message after a client's INITIAL
    // session (G2 "Initial Session Welcome" / equipment-list email). Scope to the
    // initial session by CALENDAR (see isClientInitialSession), not by a session-
    // count field. For returning clients no per-session workflow exists by design
    // (E3/E4/E5 nurture flows handle ongoing touches via sessions_remaining
    // triggers, not per-attendance), so flagging every follow-up generates false
    // positives — see audit-triage 2026-05-31 + GHL-WORKFLOWS-MASTER.md G2/I3/H2.
    if (appt.appointmentStatus === "showed") {
      if (isClientInitialSession(appt)) {
        const conv = await cache.getConversations(appt.contactId);
        if (conv && conv !== "scope_missing" && Array.isArray(conv)) {
          const allMsgs = conv.flatMap((t) => t.messages || []);
          const twoHoursAfter = new Date(apptEnd.getTime() + 2 * 60 * 60 * 1000);
          const postSession = allMsgs.filter(
            (m) => m.direction === "outbound" && new Date(m.date) >= apptEnd && new Date(m.date) <= twoHoursAfter
          );

          if (postSession.length === 0) {
            issues.push(issue(
              "warning", "appointment", appt.contactId, name,
              "no_post_session_message",
              "Post-session email/SMS should send within 2h of the INITIAL session end (G2 'Initial Session Welcome' / equipment-list)",
              "No outbound message found in that window",
              "Check if G2 'Initial Session Welcome' workflow fired"
            ));
          }
        }
      }

      if (tags.includes("affiliate-partner")) {
        issues.push(issue(
          "info", "appointment", appt.contactId, name,
          "partner_session_verify",
          "Partner post-session notification should have sent to Garrett",
          "Cannot verify via API — manual check needed",
          "Verify Garrett received partner post-session notification SMS"
        ));
      }
    }

    // Status "no_show" — verify no-show sequence
    if (appt.appointmentStatus === "no_show") {
      const conv = await cache.getConversations(appt.contactId);
      if (conv && conv !== "scope_missing" && Array.isArray(conv)) {
        const allMsgs = conv.flatMap((t) => t.messages || []);
        const dayAfter = new Date(apptEnd.getTime() + 24 * 60 * 60 * 1000);
        const noShowMsgs = allMsgs.filter(
          (m) => m.direction === "outbound" && new Date(m.date) >= apptEnd && new Date(m.date) <= dayAfter
        );

        if (noShowMsgs.length === 0) {
          issues.push(issue(
            "warning", "appointment", appt.contactId, name,
            "no_show_no_followup",
            "No-show email/SMS sequence should fire after missed appointment",
            "No outbound message found within 24h of no-show",
            "Check 'No Show Email SMS series' workflow enrollment"
          ));
        }
      }
    }
  }

  return issues;
}

// ── Rule Set 2: Purchase-triggered automations ──

export async function auditPurchases({ env, cache, auditStart, auditEnd }) {
  const issues = [];
  let purchasesChecked = 0;

  let orders = [];
  try {
    const { orders: all, hitCap } = await fetchAllOrders(env);
    orders = all.filter((o) => {
      const d = new Date(o.createdAt || o.dateAdded);
      return d >= new Date(auditStart) && d <= new Date(auditEnd);
    });
    if (hitCap) {
      issues.push(issue(
        "warning", "purchase", "", "",
        "orders_pagination_cap_hit",
        `Should scan all orders, not just the first ${ORDER_PAGE_CAP * ORDER_PAGE_LIMIT}`,
        ORDER_CAP_MSG,
        "Raise ORDER_PAGE_CAP in daily-audit-worker/src/rules.js"
      ));
    }
  } catch (err) {
    issues.push(issue(
      "warning", "purchase", "", "",
      "orders_fetch_failed",
      "Should be able to query recent orders",
      `Orders API error: ${err.message}`,
      "Check payments/orders.readonly scope"
    ));
    return { issues, purchasesChecked: 0 };
  }

  for (const order of orders) {
    const contactId = order.contactId || order.contact?.id;
    if (!contactId) continue;

    const productConfig = findAuditedProduct(order);
    if (!productConfig) {
      // A paid order ≥ $400 that maps to no known product = likely a package
      // product added in GHL but missing from the catalog → a paid client
      // silently not credited (Jenn POS class). Surface it; otherwise skip the
      // benign à-la-carte / draw-down no-ops.
      if (isUnmappedHighValueOrder(order)) {
        const cached = await cache.getContact(contactId);
        const amt = Number(order.amount ?? order.total ?? 0);
        issues.push(issue(
          "warning", "purchase", contactId, cached?.name || "Unknown",
          "unmapped_high_value_purchase",
          `A paid order ≥ $${UNMAPPED_ALERT_MIN_AMOUNT} should map to a known product`,
          `Paid $${amt} order (${order._id || order.id || "?"}) has no recognized product`,
          "Likely a package product added in GHL but missing from functions/lib/ghl-products.js — add it so it credits + audits"
        ));
      }
      continue;
    }

    purchasesChecked++;
    const cached = await cache.getContact(contactId);
    if (!cached) continue;

    const { name, tags, fields } = cached;

    if (remainingIndicatesUndercredit(fields.sessions_remaining, productConfig.increment)) {
      issues.push(issue(
        "critical", "purchase", contactId, name,
        "sessions_remaining_not_incremented",
        `sessions_remaining should be ~${productConfig.increment} after ${productConfig.name} (allowing up to ${REMAINING_WINDOW_TOLERANCE} same-window draw-downs)`,
        `sessions_remaining is ${fields.sessions_remaining}`,
        "Check ghl-purchase-webhook.js and PURCHASE_KV idempotency key"
      ));
    }

    if (productConfig.seriesType && fields.series_type !== productConfig.seriesType) {
      issues.push(issue(
        "critical", "purchase", contactId, name,
        "series_type_not_set",
        `series_type should be "${productConfig.seriesType}" after ${productConfig.name}`,
        `series_type is "${fields.series_type}"`,
        "Check GHL purchase workflow and backup webhook"
      ));
    }

    if (!fields.portal_access) {
      issues.push(issue(
        "critical", "purchase", contactId, name,
        "portal_access_not_set",
        "portal_access should be true after any purchase",
        `portal_access is ${fields.portal_access}`,
        "Check GHL purchase workflow — portal_access action may be missing"
      ));
    }

    if (tags.includes("ambassador-prospect")) {
      issues.push(issue(
        "warning", "purchase", contactId, name,
        "ambassador_tag_not_removed",
        "ambassador-prospect tag should be removed after purchase",
        "Tag is still present",
        "Check purchase workflow — Remove Tag action may be missing"
      ));
    }

    if (tags.includes("discovery call attended")) {
      issues.push(issue(
        "warning", "purchase", contactId, name,
        "discovery_tag_not_removed",
        "discovery call attended tag should be removed after purchase",
        "Tag is still present",
        "Check purchase workflow — Remove Tag action may be missing"
      ));
    }
  }

  return { issues, purchasesChecked };
}

// ── Rule Set 3: Tag/field consistency ──

export async function auditTagConsistency({ cache }) {
  const issues = [];

  for (const [, cached] of cache.contacts) {
    if (!cached) continue;
    const { contact, name, fields, tags } = cached;

    if (tags.includes("partner-declined") && (tags.includes("ambassador-prospect") || tags.includes("affiliate-partner"))) {
      issues.push(issue(
        "warning", "consistency", contact.id, name,
        "declined_partner_still_tagged",
        "Declined partner should not have active partner/prospect tag",
        `Has partner-declined AND ${tags.includes("ambassador-prospect") ? "ambassador-prospect" : "affiliate-partner"}`,
        "Remove the active partner/prospect tag"
      ));
    }

    if (tags.includes("ambassador-prospect") && tags.includes("affiliate-partner")) {
      issues.push(issue(
        "warning", "consistency", contact.id, name,
        "dual_tags",
        "Should have either ambassador-prospect OR affiliate-partner, not both",
        "Both tags present",
        "Remove ambassador-prospect — partner bypassed normal flow"
      ));
    }

    const hasActiveSeries = fields.series_type && fields.series_type !== "none" && fields.series_type !== "";

    if (hasActiveSeries && String(fields.sessions_remaining) === "0") {
      issues.push(issue(
        "warning", "consistency", contact.id, name,
        "sessions_exhausted_no_outreach",
        "Sessions exhausted — client should receive re-engagement outreach",
        `series_type="${fields.series_type}" but sessions_remaining=0`,
        "No sessions-exhausted workflow exists yet"
      ));
    }
  }

  return issues;
}

// Fetch succeeded, package-sized INVOICE-billed sales. These live ONLY in
// /payments/transactions (entityType:invoice) + /invoices/ — never in /payments/orders —
// so the order-only scans miss them entirely (Betsy's $1,295 8-pack invoice was invisible
// to the audit, which then mis-flagged her against her smaller 4-pack ORDER). Returns:
//   recognized: [{contactId, seriesType, productName}]  — maps to a known package
//   unmapped:   [{contactId, amount, invoice}]          — paid invoice ≥ threshold, no known product
// Hydration failures are SKIPPED (not flagged) so a transient API error can't masquerade
// as a catalog gap.
async function fetchInvoicePackages(env) {
  const recognized = [];
  const unmapped = [];
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  for (let page = 0; page < ORDER_PAGE_CAP; page++) {
    const offset = page * ORDER_PAGE_LIMIT;
    const data = await ghlFetch(
      env,
      `/payments/transactions?altId=${LOCATION_ID}&altType=location&limit=${ORDER_PAGE_LIMIT}&offset=${offset}`
    );
    const batch = data.data || data.transactions || [];
    if (batch.length === 0) break;
    for (const t of batch) {
      if (t.entityType !== "invoice") continue;
      if (t.status !== "succeeded") continue;
      if (Number(t.amount) < UNMAPPED_ALERT_MIN_AMOUNT) continue; // package-sized only
      const created = new Date(t.createdAt || t.updatedAt).getTime();
      if (Number.isFinite(created) && created < cutoff) continue;
      const contactId = t.contactId || t.contactSnapshot?.id;
      if (!contactId || !t.entityId) continue;
      let inv;
      try {
        inv = await ghlFetch(env, `/invoices/${t.entityId}?altId=${LOCATION_ID}&altType=location`);
      } catch {
        continue; // hydration failed — skip rather than mis-flag as a catalog gap
      }
      const cfg = classifyInvoiceItems(inv?.invoiceItems || inv?.items || []);
      if (cfg && cfg.seriesType) {
        recognized.push({ contactId, seriesType: cfg.seriesType, productName: cfg.name });
      } else {
        unmapped.push({ contactId, amount: Number(t.amount), invoice: inv?.invoiceNumber || t.entitySourceName || t.entityId });
      }
    }
    if (batch.length < ORDER_PAGE_LIMIT) break;
  }
  return { recognized, unmapped };
}

// ── Rule Set 3b: Historical series_type drop detection ──
//
// Flags contacts with sessions_completed > 0 but series_type null/empty ONLY IF
// their order history shows they bought a pack (4-session / 8-session / upgrade).
// Per-session payers (Single Follow-up, Entrainment only) are correctly null
// and must NOT be flagged.
//
// Example that caused this rule to exist: Tae-Woo Kim had SC=3 + series_type=null
// and was flagged as a P1 drift gap on 2026-04-11. Investigation on 2026-04-21
// showed he was a per-session payer (3x single orders totaling $370, no pack).
// series_type=null was correct; the rule was the bug.

export async function auditSeriesTypeDrops({ env, cache }) {
  const issues = [];

  // Fetch a wider window of orders to catch pack purchases made months ago.
  let orders = [];
  try {
    const { orders: all, hitCap } = await fetchAllOrders(env);
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    orders = all.filter((o) => {
      const d = new Date(o.createdAt || o.dateAdded);
      return d.getTime() >= cutoff;
    });
    if (hitCap) {
      issues.push(issue(
        "warning", "consistency", "", "",
        "series_type_drop_orders_cap_hit",
        "Should scan all orders for historical pack purchases",
        ORDER_CAP_MSG,
        "Raise ORDER_PAGE_CAP in daily-audit-worker/src/rules.js"
      ));
    }
  } catch (err) {
    issues.push(issue(
      "warning", "consistency", "", "",
      "series_type_drop_check_skipped",
      "Should be able to query orders for historical series_type drop detection",
      `Orders API error: ${err.message}`,
      "Check payments/orders.readonly scope"
    ));
    return issues;
  }

  // Build: contactId → expected seriesType from their pack purchases. 8-session is
  // authoritative over 4-session when a contact has both (the upgrade/larger pack wins).
  const packBuyers = new Map();
  const setPackBuyer = (contactId, expected, productName) => {
    if (!contactId || !expected) return;
    const existing = packBuyers.get(contactId);
    if (existing && existing.expected === "8-session" && expected !== "8-session") return; // don't downgrade
    packBuyers.set(contactId, { expected, productName });
  };
  for (const order of orders) {
    const contactId = order.contactId || order.contact?.id;
    const productConfig = findAuditedProduct(order);
    if (productConfig?.seriesType) setPackBuyer(contactId, productConfig.seriesType, productConfig.name);
  }

  // Merge in INVOICE-billed packages — absent from /payments/orders, so an invoice-pack
  // buyer whose series_type got dropped is otherwise never caught here. Also surface any
  // unmapped high-value invoice (a package product missing from the catalog — invisible
  // to orders, the ledger's classifyInvoice, AND the funnel).
  let invoicePkgs = { recognized: [], unmapped: [] };
  try {
    invoicePkgs = await fetchInvoicePackages(env);
  } catch (err) {
    issues.push(issue(
      "warning", "consistency", "", "",
      "invoice_package_scan_failed",
      "Should be able to scan invoice-billed packages (payments/transactions + invoices)",
      `Invoice scan error: ${err.message}`,
      "Check payments/transactions + invoices read scope"
    ));
  }
  for (const pkg of invoicePkgs.recognized) setPackBuyer(pkg.contactId, pkg.seriesType, pkg.productName);
  for (const u of invoicePkgs.unmapped) {
    const cached = await cache.getContact(u.contactId);
    issues.push(issue(
      "warning", "purchase", u.contactId, cached?.name || "Unknown",
      "unmapped_high_value_invoice",
      `A paid invoice ≥ $${UNMAPPED_ALERT_MIN_AMOUNT} should map to a known product`,
      `Paid $${u.amount} invoice (${u.invoice}) maps to no recognized product`,
      "Likely a package product missing from functions/lib/ghl-products.js — add it so it credits + audits"
    ));
  }

  for (const [, cached] of cache.contacts) {
    if (!cached) continue;
    const { contact, name, fields } = cached;

    const sc = parseInt(fields.sessions_completed, 10);
    if (isNaN(sc) || sc <= 0) continue;

    const seriesType = fields.series_type;
    const isMissing = !seriesType || seriesType === "" || seriesType === "none";
    if (!isMissing) continue;

    const pack = packBuyers.get(contact.id);
    if (!pack) continue; // Per-session payer — correct state, skip.

    issues.push(issue(
      "critical", "consistency", contact.id, name,
      "series_type_dropped",
      `series_type should be "${pack.expected}" — contact bought ${pack.productName}`,
      `series_type is "${fields.series_type ?? "null"}" with sessions_completed=${sc}`,
      "Set series_type field manually in GHL; check purchase webhook for the drop"
    ));
  }

  return issues;
}

// ── Rule Set 4: Communication verification ──

export async function auditCommunications({ cache, appointments }) {
  const issues = [];

  for (const appt of appointments) {
    if (!appt.contactId) continue;
    if (appt.appointmentStatus === "cancelled") continue;

    const cached = await cache.getContact(appt.contactId);
    const name = cached?.name || "Unknown";

    const conv = await cache.getConversations(appt.contactId);
    if (!conv || conv === "scope_missing" || !Array.isArray(conv)) continue;

    const allMsgs = conv.flatMap((t) => t.messages || []);
    const apptStart = new Date(appt.startTime);

    // Pre-session reminder check (12-48h before)
    const twoDaysBefore = new Date(apptStart.getTime() - 48 * 60 * 60 * 1000);
    const preSession = allMsgs.filter((m) => {
      if (m.direction !== "outbound") return false;
      const d = new Date(m.date);
      return d >= twoDaysBefore && d <= apptStart;
    });

    if (preSession.length === 0) {
      issues.push(issue(
        "info", "communication", appt.contactId, name,
        "no_pre_session_reminder",
        "Pre-session reminder should send 24-48h before appointment",
        "No outbound message found in that window",
        "Check if reminder workflow is set up for this calendar"
      ));
    }

    // Duplicate message check (same first 100 chars within 1h)
    const outboundByBody = {};
    for (const m of allMsgs) {
      if (m.direction !== "outbound" || !m.body) continue;
      const key = m.body.substring(0, 100);
      if (!outboundByBody[key]) outboundByBody[key] = [];
      outboundByBody[key].push(new Date(m.date));
    }

    for (const [snippet, dates] of Object.entries(outboundByBody)) {
      if (dates.length < 2) continue;
      const sorted = [...dates].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        if (gap < 60 * 60 * 1000) {
          issues.push(issue(
            "warning", "communication", appt.contactId, name,
            "duplicate_message",
            "Same message should not send twice within 1 hour",
            `"${snippet.substring(0, 50)}..." sent ${Math.round(gap / 60000)} min apart`,
            "Check for overlapping workflow triggers"
          ));
          break;
        }
      }
    }
  }

  return issues;
}

// ── Rule Set 5: State mismatch detection ──

export async function auditStateMismatches({ env, cache, auditStart }) {
  const issues = [];

  // Fetch recent purchasers (30-day window for catching stale workflows)
  let recentPurchaserIds = [];
  try {
    const { orders: all, hitCap } = await fetchAllOrders(env);
    const orders = all.filter((o) => {
      const d = new Date(o.createdAt || o.dateAdded);
      return d >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    });
    recentPurchaserIds = orders
      .map((o) => o.contactId || o.contact?.id)
      .filter(Boolean);
    if (hitCap) {
      issues.push(issue(
        "warning", "state_mismatch", "", "",
        "state_mismatch_orders_cap_hit",
        "Should scan all recent orders for stale-workflow detection",
        ORDER_CAP_MSG,
        "Raise ORDER_PAGE_CAP in daily-audit-worker/src/rules.js"
      ));
    }
  } catch {
    // Continue without purchase data
  }

  // Fetch upcoming appointments (next 3 days) for booking-prompt detection
  const appointedContactIds = new Set();
  try {
    const today = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      try {
        const appts = await fetchAppointmentsForDate(env, dateStr);
        for (const a of appts) {
          if (a.contactId) appointedContactIds.add(a.contactId);
        }
      } catch {
        // Single day failed — continue
      }
    }
  } catch {
    // Continue without appointment data
  }

  const contactIds = [...new Set(recentPurchaserIds)];

  for (const contactId of contactIds) {
    const cached = await cache.getContact(contactId);
    if (!cached) continue;

    const { name, fields, tags } = cached;

    // Check 1: Upsell for product they already own
    if (fields.series_type) {
      const conv = await cache.getConversations(contactId);
      if (conv && conv !== "scope_missing" && Array.isArray(conv)) {
        const allMsgs = conv.flatMap((t) => t.messages || []);
        const recentOutbound = allMsgs.filter(
          (m) => m.direction === "outbound" && new Date(m.date) >= new Date(auditStart)
        );

        for (const msg of recentOutbound) {
          const bodyLower = (msg.body || "").toLowerCase();

          for (const pattern of UPSELL_PATTERNS) {
            if (fields.series_type === pattern.seriesType) {
              const matched = pattern.keywords.find((kw) => bodyLower.includes(kw));
              if (matched && (bodyLower.includes("upgrade") || bodyLower.includes("ready to") || bodyLower.includes("check out"))) {
                issues.push(issue(
                  "critical", "state_mismatch", contactId, name,
                  "upsell_after_purchase",
                  `Should not upsell ${pattern.seriesType} to someone who already has it`,
                  `Message contains "${matched}" but series_type="${fields.series_type}"`,
                  "Check which workflow sent this — missing series_type filter"
                ));
              }
            }
          }

          // Booking prompt when already booked
          if (appointedContactIds.has(contactId)) {
            const bookingPhrases = ["ready to book", "book your", "schedule your", "book a session", "grab a spot"];
            const matchedPhrase = bookingPhrases.find((p) => bodyLower.includes(p));
            if (matchedPhrase) {
              issues.push(issue(
                "warning", "state_mismatch", contactId, name,
                "booking_prompt_when_already_booked",
                "Should not prompt to book when contact has an upcoming appointment",
                `Message contains "${matchedPhrase}" but contact has appointment`,
                "Workflow needs condition to skip if upcoming appointment exists"
              ));
            }
          }
        }
      }
    }

    // Check 2: Active client in lead nurture
    const isActive = fields.series_type && parseInt(fields.sessions_remaining, 10) > 0;
    if (isActive && tags.includes("quiz submitted") && !tags.includes("workflow 3")) {
      issues.push(issue(
        "warning", "state_mismatch", contactId, name,
        "active_client_in_lead_nurture",
        "Active client should not be in lead nurture",
        `series_type="${fields.series_type}", sessions_remaining=${fields.sessions_remaining}, but has "quiz submitted" tag`,
        "Remove 'quiz submitted' tag or add 'workflow 3' tag"
      ));
    }

    // Check 3: Stale discovery tag on active client
    if (isActive && tags.includes("discovery call attended")) {
      issues.push(issue(
        "info", "state_mismatch", contactId, name,
        "stale_discovery_tag",
        "Active client should not have 'discovery call attended' tag",
        "Has active series but tag still present",
        "Remove tag — purchase workflow should have cleaned this up"
      ));
    }
  }

  return issues;
}
