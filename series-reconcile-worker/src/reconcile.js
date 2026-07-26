// Reconciliation logic — mirrors the C-series workflow actions documented in
// GHL-WORKFLOWS-MASTER.md and the PRODUCT_MAP from
// functions/api/ghl-purchase-webhook.js. Kept in sync manually — if the
// workflow set of actions changes in GHL, update this file.

import { getContact, patchContact, addContactNote, removeContactTags, ghlGet, getOrderDetail, LOCATION_ID } from "./ghl.js";
import { PACKAGE_MAP } from "../../functions/lib/ghl-products.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../../functions/lib/ghl-fields.js";
import { deriveLedger } from "../../functions/lib/session-ledger.js";
import { hydrateOrders } from "../../functions/lib/ghl-orders.js";
import { claimProcessedEvent, isProcessedEvent } from "../../functions/lib/processed-events.js";

// Series + upgrade products. Derived from the single source of truth
// (functions/lib/ghl-products.js → PACKAGE_MAP) plus the per-package GHL
// workflow code (note-text only). Single Follow-up + Initial bookings aren't
// packages, so PACKAGE_MAP excludes them — out of scope here.
const WORKFLOW_CODES = {
  "69986faa724ecd2343ebaa6e": "C1",  // 4-Session Series
  "69987357c839790426996114": "C2",  // 8-Session Series
  "6998739230cc6054f9bba62d": "C1b", // Upgrade: Initial → 4
  "699873d6990b71ebc1fa26b4": "C2b", // Upgrade: Initial → 8
  "6a010952e41b442c862d3c01": "C2c", // Upgrade: 4 → 8
};

export const PACKAGE_PRODUCTS = Object.fromEntries(
  Object.entries(PACKAGE_MAP).map(([id, p]) => [id, { ...p, workflowCode: WORKFLOW_CODES[id] }]),
);

export const FIELD_IDS = {
  series_type: GHL_FIELD_IDS.series_type,
  sessions_remaining: GHL_FIELD_IDS.sessions_remaining,
  portal_access: GHL_FIELD_IDS.portal_access,
  living_practice_access: GHL_FIELD_IDS.living_practice_access,
  sessions_remaining_locked: GHL_FIELD_IDS.sessions_remaining_locked,
  // Same rationale as sync.js's LEDGER_FIELD_DEFS: without this, deriveLedger's
  // prepaid-override guard can't fire, so a prepaid-flagged contact with no
  // matching orders would derive purchased=0 at HIGH confidence instead of
  // "unknown". Passed to deriveLedger below, same as sync.js.
  session_prepaid: GHL_FIELD_IDS.session_prepaid,
};

// Same KV prefix + namespace (PORTAL_KV) sync.js uses for large-delta/
// low-confidence flags — one shared review queue, not a second one.
const KV_NEEDS_REVIEW_PREFIX = "field-sync:needsReview:";

// Tags the C-series workflows remove (idempotent — safe to "remove" tags the
// contact doesn't have).
export const REMOVE_TAGS = ["discovery call attended", "quiz submitted", "ambassador-prospect"];

// Idempotency keys in PURCHASE_KV. The worker's own records live under
// `processed:<orderId>`; the Pages-function backup webhook
// (functions/api/ghl-purchase-webhook.js) records under `order:<orderId>` —
// a DIFFERENT prefix. A 2026-07-02 audit found the old comment here claimed
// they shared a key; they never did, so the worker must read BOTH and write
// BOTH for the two systems to actually dedupe each other. (The webhook's
// D1-first path is currently inert — the amari-attendance database has no
// tables — so its KV fallback key is the live signal.)
export const purchaseKvKey = (orderId) => `processed:${orderId}`;
export const webhookKvKey = (orderId) => `order:${orderId}`;

export function readField(contact, fieldId) {
  const cf = (contact.customFields || []).find((x) => x.id === fieldId);
  if (!cf) return null;
  return cf.value ?? cf.field_value;
}

function isCheckedCheckbox(value) {
  if (Array.isArray(value)) return value.includes("true");
  return value === true || value === "true";
}

// Find the package product on an order's line items. Returns { productId, pkg }
// or null if no line item maps to a package product.
export function selectPackageProduct(items) {
  for (const item of items || []) {
    const productId = item?.product?._id;
    const pkg = productId ? PACKAGE_PRODUCTS[productId] : null;
    if (pkg) return { productId, pkg };
  }
  return null;
}

// Was sessions_remaining ever actually written? A never-written GHL field reads
// null/undefined/"" via readField; a drawn-down balance reads the STRING "0".
// That asymmetry is load-bearing for isReconcileAlreadyApplied below.
export function remainingWasWritten(currentRemaining) {
  return (
    currentRemaining !== null &&
    currentRemaining !== undefined &&
    String(currentRemaining).trim() !== ""
  );
}

// Pure: should this orphan package purchase be treated as ALREADY applied (and
// skipped)? (#3 fix, 2026-06-07.) The pre-fix check matched series_type +
// portal_access + living_practice but NOT sessions_remaining — so a partial
// failure that set those three and died before writing sessions_remaining was
// skipped on every run, leaving a PAID client stuck at 0 with no alert.
//
// We now ALSO require sessions_remaining to have been written. CRITICAL: we only
// fall through to re-apply when remaining was NEVER written (null/empty) — never
// when it holds a real number, INCLUDING a drawn-down "0". The apply path SETS
// remaining to the full pack size, so re-applying on a written value would reset
// a mid-package client's balance to full — a worse over-credit bug than the one
// we're fixing. `seriesIsAdvanced` (a later upgrade overwrote this order's
// package) is its own escape hatch and doesn't need the remaining check.
export function isReconcileAlreadyApplied({ currentSeriesType, currentPortal, currentLP, currentRemaining, pkg }) {
  const seriesMatches = currentSeriesType === pkg.seriesType;
  const lpOk = !pkg.livingPractice || currentLP;
  const seriesIsAdvanced =
    pkg.seriesType === "4-session" && currentSeriesType === "8-session";
  return (
    seriesIsAdvanced ||
    (seriesMatches && currentPortal && lpOk && remainingWasWritten(currentRemaining))
  );
}

// Returns one of: "skip-not-package", "skip-already-processed", "skip-not-paid",
// "skip-already-applied", "applied", "errored". Plus a details object.
export async function reconcileOrder(env, orderDetail) {
  const orderId = orderDetail._id;
  const contactId = orderDetail.contactId;
  const paymentStatus = orderDetail.paymentStatus;
  const match = selectPackageProduct(orderDetail.items);
  const productId = match?.productId ?? (orderDetail.items || [])[0]?.product?._id;
  const pkg = match?.pkg ?? null;

  if (!pkg) {
    return { status: "skip-not-package", orderId, productId, contactId };
  }
  if (paymentStatus !== "paid") {
    return { status: "skip-not-paid", orderId, productId, paymentStatus, contactId };
  }
  if (!contactId) {
    return { status: "skip-no-contact", orderId };
  }

  // Idempotency: have we processed this order before — by us (processed:) OR
  // by the Pages-function backup webhook (order:)? Both keys, both systems.
  const kvKey = purchaseKvKey(orderId);
  const webhookKey = webhookKvKey(orderId);
  const [existing, webhookExisting] = await Promise.all([
    env.PURCHASE_KV.get(kvKey),
    env.PURCHASE_KV.get(webhookKey),
  ]);
  if (existing) {
    return { status: "skip-already-processed", orderId, package: pkg.name, contactId, processedAt: existing };
  }
  // D1 view: once the amari-attendance schema is live (created 2026-07-02),
  // the webhook's primary claim lives there. Read-only check; null (no
  // binding / D1 error) just means the KV checks above were the whole story.
  const webhookClaimedD1 = await isProcessedEvent(env.ATTEND_DB, webhookKey);
  if (webhookExisting || webhookClaimedD1) {
    // The webhook applied this order. Back-fill our own marker so the next
    // hourly scan skips on the first read, then skip without touching the
    // contact — the field-state check below was the only guard here before,
    // and the additive 4→8 upgrade can race past it.
    await env.PURCHASE_KV.put(
      kvKey,
      JSON.stringify({
        reconciledAt: new Date().toISOString(),
        by: "series-reconcile-worker",
        action: "marked-idempotent",
        reason: webhookExisting
          ? "already processed by the purchase webhook (order: key)"
          : "already processed by the purchase webhook (D1 claim)",
      }),
      { expirationTtl: 90 * 86400 }
    );
    return { status: "skip-already-processed", orderId, package: pkg.name, contactId, processedAt: webhookExisting || "d1-claim" };
  }

  // Read the contact and check current state. If the field set already matches
  // what the workflow would have applied, mark idempotent + don't re-apply
  // (the workflow probably DID fire; we just don't have a KV record because
  // backup-webhook never wrote one).
  const contact = await getContact(env, contactId);
  if (!contact) {
    return { status: "errored", orderId, contactId, error: "contact not found" };
  }

  // Hard lock: if `sessions_remaining_locked` is checked, Garrett's intent
  // overrides any automated derivation (one-off comps, manual credits). The
  // sync-sweep path (sync.js) already honors this; this order path must too,
  // or a locked contact who makes a package purchase gets their pinned balance
  // overwritten by the orphan-apply below (CRIT-B, 2026-06-11 review). Skip
  // before any read/write — and do NOT write an idempotency record, so the
  // order stays re-checkable if the lock is later lifted.
  if (isCheckedCheckbox(readField(contact, FIELD_IDS.sessions_remaining_locked))) {
    return {
      status: "skip-locked",
      orderId,
      package: pkg.name,
      contactId,
      contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
    };
  }

  const currentSeriesType = readField(contact, FIELD_IDS.series_type);
  const currentPortal = isCheckedCheckbox(readField(contact, FIELD_IDS.portal_access));
  const currentLP = isCheckedCheckbox(readField(contact, FIELD_IDS.living_practice_access));
  const currentRemaining = readField(contact, FIELD_IDS.sessions_remaining);

  // SPECIAL CASE (for the idempotency note below): the contact's series_type is
  // already a HIGHER package than this order would set (e.g. order is a 4-pack
  // but the contact is on an 8-pack from a later upgrade) → the order was
  // processed then overwritten.
  const seriesIsAdvanced =
    pkg.seriesType === "4-session" && currentSeriesType === "8-session";

  // #3 (2026-06-07): the already-applied check now ALSO requires
  // sessions_remaining to have been written — a partial failure that set
  // series/portal/LP but never wrote remaining was previously skipped forever,
  // stranding a paid client at 0. See isReconcileAlreadyApplied (over-credit-safe).
  if (isReconcileAlreadyApplied({ currentSeriesType, currentPortal, currentLP, currentRemaining, pkg })) {
    // Workflow already fired (or was overwritten by a later upgrade). Record
    // idempotency so we don't re-evaluate every hour.
    const note = seriesIsAdvanced
      ? `workflow fired but later overwritten by ${currentSeriesType} package`
      : "workflow already applied";
    await env.PURCHASE_KV.put(
      kvKey,
      JSON.stringify({
        reconciledAt: new Date().toISOString(),
        by: "series-reconcile-worker",
        action: "marked-idempotent",
        reason: note,
      }),
      { expirationTtl: 90 * 86400 }
    );
    return {
      status: "skip-already-applied",
      orderId,
      package: pkg.name,
      contactId,
      currentSeriesType,
      reason: note,
    };
  }

  // ── ORPHAN. Apply C-series workflow simulation ──
  // sessions_remaining: use the SAME deriveLedger() sync.js and daily-audit-worker
  // use, not a local "current + delta" formula. The formula only ever sees THIS
  // order — if the pre-purchase field value was already wrong (or this order's
  // classification doesn't match what deriveLedger's classifyOrder would say),
  // the formula faithfully propagates the wrong number forward. deriveLedger
  // recomputes from the full order/invoice/appointment history every time, so
  // it can't inherit a stale current-field error. Falls back to the formula
  // (and flags for human review) only when deriveLedger itself isn't confident —
  // keeps a paying client unblocked (portal access etc. still get set below)
  // rather than stalling them on a human review queue.
  const formulaRemaining = pkg.isAdditive
    ? (parseInt(currentRemaining, 10) || 0) + pkg.sessionsToSet
    : pkg.sessionsToSet;

  let newRemaining = formulaRemaining;
  let ledgerConfidence = null;
  try {
    const [ordersRes, invoicesRes, apptRes] = await Promise.all([
      ghlGet(env, `/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`),
      ghlGet(env, `/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`),
      ghlGet(env, `/contacts/${contactId}/appointments`),
    ]);
    const ordersList = ordersRes.data || ordersRes.orders || [];
    const invoices = invoicesRes.invoices || [];
    const appointments = apptRes.appointments || apptRes.events || [];
    const orders = await hydrateOrders((id) => getOrderDetail(env, id), ordersList);
    // Page-full guard — a full limit=100 page means older history (possibly
    // the real package purchase) fell off; don't trust the derived count.
    const ledgerFetchFailures = [];
    if (ordersList.length >= 100) ledgerFetchFailures.push("orders page full at 100 — history may be truncated");
    if (invoices.length >= 100) ledgerFetchFailures.push("invoices page full at 100 — history may be truncated");
    const ledger = deriveLedger({
      contact, orders, invoices, appointments,
      fieldDefs: { session_prepaid: FIELD_IDS.session_prepaid },
      fetchFailures: ledgerFetchFailures,
    });
    ledgerConfidence = ledger.confidence;
    if (ledger.confidence === "high") {
      newRemaining = ledger.remaining;
    } else {
      await env.PORTAL_KV.put(
        KV_NEEDS_REVIEW_PREFIX + contactId,
        JSON.stringify({
          at: new Date().toISOString(),
          contactId,
          contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
          reason: "series-reconcile-worker applied an orphan order using the fallback formula — deriveLedger confidence was not high",
          orderId,
          package: pkg.name,
          formulaRemaining,
          ledger: { remaining: ledger.remaining, purchased: ledger.purchased, attended: ledger.attended, ambiguities: ledger.ambiguities },
        }),
        { expirationTtl: 30 * 86400 },
      );
    }
  } catch (err) {
    // Full-history fetch/derivation failed (network, malformed data, etc.) —
    // fall back to the formula rather than leaving a paying client unprovisioned.
    // Flag it the same way as a low-confidence result, so a human knows the
    // number came from the fallback path, not the authoritative derivation.
    await env.PORTAL_KV.put(
      KV_NEEDS_REVIEW_PREFIX + contactId,
      JSON.stringify({
        at: new Date().toISOString(),
        contactId,
        contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
        reason: "series-reconcile-worker applied an orphan order using the fallback formula — deriveLedger errored",
        orderId,
        package: pkg.name,
        formulaRemaining,
        error: String(err.message || err).slice(0, 300),
      }),
      { expirationTtl: 30 * 86400 },
    );
  }

  const customFields = [
    { id: FIELD_IDS.series_type, value: pkg.seriesType },
    { id: FIELD_IDS.sessions_remaining, value: newRemaining },
    { id: FIELD_IDS.portal_access, value: ["true"] },
  ];
  if (pkg.livingPractice) {
    customFields.push({ id: FIELD_IDS.living_practice_access, value: ["true"] });
  }

  const tagsRemoved = (contact.tags || []).filter((t) => REMOVE_TAGS.includes(t));

  // Write fields and remove tags as SEPARATE operations. patchContact must NOT
  // receive a tags array here — a wholesale PUT replace would clobber any tag a
  // concurrent GHL workflow set between our read and write (GHL triggers are
  // tag-driven). removeContactTags deletes only the named tags additively.
  await patchContact(env, contactId, customFields);
  if (tagsRemoved.length) {
    await removeContactTags(env, contactId, tagsRemoved);
  }

  const remainingSource = ledgerConfidence === "high" ? "ledger" : "formula (flagged for review)";
  const noteBody = `[series-reconcile-worker ${new Date().toISOString().slice(0, 10)}] Auto-reconciled orphan ${pkg.name} purchase. Order ${orderId} (${orderDetail.source?.type || "unknown"}/${orderDetail.source?.id || "?"}) was paid but the ${pkg.workflowCode} workflow did not fire. Applied: series_type=${pkg.seriesType}, sessions_remaining=${newRemaining} (source: ${remainingSource}), portal_access=true${pkg.livingPractice ? ", living_practice_access=true" : ""}${tagsRemoved.length ? `, removed tags: ${tagsRemoved.join(", ")}` : ""}.`;
  await addContactNote(env, contactId, noteBody);

  await env.PURCHASE_KV.put(
    kvKey,
    JSON.stringify({
      reconciledAt: new Date().toISOString(),
      by: "series-reconcile-worker",
      action: "applied",
      package: pkg.name,
      seriesType: pkg.seriesType,
      sessionsRemaining: newRemaining,
      remainingSource,
      tagsRemoved,
    }),
    { expirationTtl: 90 * 86400 }
  );
  // Also stamp the WEBHOOK's key so its KV idempotency path skips this order
  // if the (late) webhook delivery arrives after we applied — without this,
  // only the webhook's field-state logic stood between a worker-applied
  // additive upgrade and a second credit.
  await env.PURCHASE_KV.put(
    webhookKey,
    JSON.stringify({
      processedAt: new Date().toISOString(),
      by: "series-reconcile-worker",
    }),
    { expirationTtl: 90 * 86400 }
  );
  // And claim in D1 (best-effort) — the webhook trusts its D1 view first, so
  // without this row a late webhook delivery would sail past the KV stamp.
  try {
    await claimProcessedEvent(env.ATTEND_DB, webhookKey);
  } catch (err) {
    console.warn(`[series-reconcile] D1 claim failed for ${orderId}: ${err.message}`);
  }

  return {
    status: "applied",
    orderId,
    package: pkg.name,
    contactId,
    contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
    beforeSeriesType: currentSeriesType,
    afterSeriesType: pkg.seriesType,
    sessionsRemaining: newRemaining,
    remainingSource,
    tagsRemoved,
  };
}
