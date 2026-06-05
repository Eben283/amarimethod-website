// Reconciliation logic — mirrors the C-series workflow actions documented in
// GHL-WORKFLOWS-MASTER.md and the PRODUCT_MAP from
// functions/api/ghl-purchase-webhook.js. Kept in sync manually — if the
// workflow set of actions changes in GHL, update this file.

import { getContact, patchContact, addContactNote } from "./ghl.js";

// Series + upgrade products only. Single Follow-up + Initial Session bookings
// have different workflows (D-series + booking flow) and are out of scope here.
export const PACKAGE_PRODUCTS = {
  // 4-Session Series ($720)
  "69986faa724ecd2343ebaa6e": {
    name: "4-Session Series",
    sessionsToSet: 4,
    seriesType: "4-session",
    livingPractice: false,
    workflowCode: "C1",
  },
  // 8-Session Series ($1,295)
  "69987357c839790426996114": {
    name: "8-Session Series",
    sessionsToSet: 8,
    seriesType: "8-session",
    livingPractice: true,
    workflowCode: "C2",
  },
  // Upgrade: Initial → 4-Session ($495)
  "6998739230cc6054f9bba62d": {
    name: "Upgrade: Initial → 4-Session",
    sessionsToSet: 3,
    seriesType: "4-session",
    livingPractice: false,
    workflowCode: "C1b",
  },
  // Upgrade: Initial → 8-Session ($1,070)
  "699873d6990b71ebc1fa26b4": {
    name: "Upgrade: Initial → 8-Session",
    sessionsToSet: 7,
    seriesType: "8-session",
    livingPractice: true,
    workflowCode: "C2b",
  },
  // Upgrade: 4-Session → 8-Session ($575)
  "6a010952e41b442c862d3c01": {
    name: "Upgrade: 4-Session → 8-Session",
    sessionsToSet: 4,
    seriesType: "8-session",
    livingPractice: true,
    workflowCode: "C2c",
  },
};

export const FIELD_IDS = {
  series_type: "3i93lTkmuAV49s9nh0q8",
  sessions_remaining: "wrQSkx6BhXwDGIn1d0V4",
  portal_access: "O0xmwyRqeNK2EA1GGGye",
  living_practice_access: "1EnVtI70jC5MTshZjWvw",
};

// Tags the C-series workflows remove (idempotent — safe to "remove" tags the
// contact doesn't have).
export const REMOVE_TAGS = ["discovery call attended", "quiz submitted", "ambassador-prospect"];

// Idempotency key in PURCHASE_KV. Mirrors the key the Pages-function backup
// webhook uses (functions/api/ghl-purchase-webhook.js), so the two systems
// can't double-apply on the same order.
export const purchaseKvKey = (orderId) => `processed:${orderId}`;

function readField(contact, fieldId) {
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

  // Idempotency: have we processed this order before (either by us or by the
  // Pages-function backup webhook)?
  const kvKey = purchaseKvKey(orderId);
  const existing = await env.PURCHASE_KV.get(kvKey);
  if (existing) {
    return { status: "skip-already-processed", orderId, package: pkg.name, contactId, processedAt: existing };
  }

  // Read the contact and check current state. If the field set already matches
  // what the workflow would have applied, mark idempotent + don't re-apply
  // (the workflow probably DID fire; we just don't have a KV record because
  // backup-webhook never wrote one).
  const contact = await getContact(env, contactId);
  if (!contact) {
    return { status: "errored", orderId, contactId, error: "contact not found" };
  }
  const currentSeriesType = readField(contact, FIELD_IDS.series_type);
  const currentPortal = isCheckedCheckbox(readField(contact, FIELD_IDS.portal_access));
  const currentLP = isCheckedCheckbox(readField(contact, FIELD_IDS.living_practice_access));

  const seriesMatches = currentSeriesType === pkg.seriesType;
  const portalOk = currentPortal;
  const lpOk = !pkg.livingPractice || currentLP;

  // SPECIAL CASE: if the contact's series_type is already a HIGHER package
  // than this order would set (e.g. order is for 4-pack but contact is on
  // 8-pack from a later upgrade), assume the order was correctly processed
  // and overwritten by the later purchase. Mark idempotent + skip.
  const seriesIsAdvanced =
    pkg.seriesType === "4-session" && currentSeriesType === "8-session";

  if ((seriesMatches && portalOk && lpOk) || seriesIsAdvanced) {
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
  const customFields = [
    { id: FIELD_IDS.series_type, value: pkg.seriesType },
    { id: FIELD_IDS.sessions_remaining, value: pkg.sessionsToSet },
    { id: FIELD_IDS.portal_access, value: ["true"] },
  ];
  if (pkg.livingPractice) {
    customFields.push({ id: FIELD_IDS.living_practice_access, value: ["true"] });
  }

  const newTags = (contact.tags || []).filter((t) => !REMOVE_TAGS.includes(t));
  const tagsRemoved = (contact.tags || []).filter((t) => REMOVE_TAGS.includes(t));

  await patchContact(env, contactId, customFields, newTags);

  const noteBody = `[series-reconcile-worker ${new Date().toISOString().slice(0, 10)}] Auto-reconciled orphan ${pkg.name} purchase. Order ${orderId} (${orderDetail.source?.type || "unknown"}/${orderDetail.source?.id || "?"}) was paid but the ${pkg.workflowCode} workflow did not fire. Applied: series_type=${pkg.seriesType}, sessions_remaining=${pkg.sessionsToSet}, portal_access=true${pkg.livingPractice ? ", living_practice_access=true" : ""}${tagsRemoved.length ? `, removed tags: ${tagsRemoved.join(", ")}` : ""}.`;
  await addContactNote(env, contactId, noteBody);

  await env.PURCHASE_KV.put(
    kvKey,
    JSON.stringify({
      reconciledAt: new Date().toISOString(),
      by: "series-reconcile-worker",
      action: "applied",
      package: pkg.name,
      seriesType: pkg.seriesType,
      sessionsToSet: pkg.sessionsToSet,
      tagsRemoved,
    }),
    { expirationTtl: 90 * 86400 }
  );

  return {
    status: "applied",
    orderId,
    package: pkg.name,
    contactId,
    contactName: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
    beforeSeriesType: currentSeriesType,
    afterSeriesType: pkg.seriesType,
    sessionsRemaining: pkg.sessionsToSet,
    tagsRemoved,
  };
}
