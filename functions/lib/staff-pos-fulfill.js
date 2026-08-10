// Staff POS → GHL invoice boundary.
// Runs only after a sale is fully paid and the default-off bridge is enabled.
// This module intentionally never reads or writes raw session/access fields.

import { claimProcessedEvent, releaseProcessedEvent } from "./processed-events.js";
import { recordOpsError } from "./ops-alert.js";
import { emitPathHop } from "./ops-path-emit.js";
import {
  assessPosInvoiceSupport,
  mirrorPaidPosSaleToGhlInvoice,
} from "./staff-pos-invoice-bridge.js";
import { GHL_PRODUCTS } from "./ghl-products.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "./ghl-fields.js";
import { readPosSale, writePosSale } from "./staff-pos.js";
import { issueOwnedReceipt, ownedNoEffectCart, ownedNoEffectLine } from "./staff-pos-receipts.js";

const KV_TTL_SECONDS = 90 * 86400;

function contactField(contact, id) {
  const field = contact?.customFields?.find((candidate) => candidate.id === id);
  return field ? (field.value ?? field.field_value ?? null) : null;
}

// GHL returns checkbox custom fields as either a scalar boolean or a one-item
// boolean array, depending on the endpoint/field response shape. Preserve a
// strict true-only check while accepting both documented live shapes.
function checkedField(value) {
  return value === true || (Array.isArray(value) && value.length === 1 && value[0] === true);
}

export function completeVerifiedPosSale(sale, { invoice, pkg, contact, actor = "GHL invoice webhook", now } = {}) {
  if (!sale || sale.status !== "paid") throw new Error("POS sale is not fully paid");
  if (!invoice?.id) throw new Error("Verified GHL invoice id is required");
  const checkpointId = sale.fulfillment?.invoice?.id || sale.fulfillment?.invoiceId || null;
  if (checkpointId !== invoice.id) throw new Error("GHL invoice does not match the POS checkpoint");
  const support = assessPosInvoiceSupport(sale.cart);
  const productId = support.packageProductId || support.productId || null;
  if (!support.supported || !productId) throw new Error("POS sale is not a supported fulfillment");
  const product = GHL_PRODUCTS[productId];
  if (!product || product.classification !== pkg?.classification) {
    throw new Error("GHL invoice product does not match the POS cart");
  }
  const remaining = Number(contactField(contact, GHL_FIELD_IDS.sessions_remaining));
  const seriesType = String(contactField(contact, GHL_FIELD_IDS.series_type) || "");
  const portalAccess = contactField(contact, GHL_FIELD_IDS.portal_access);
  const livingPractice = contactField(contact, GHL_FIELD_IDS.living_practice_access);
  let verifiedEffect;
  if (support.effect === "package") {
    if (remaining !== Number(pkg.sessionsRemaining) || seriesType !== pkg.seriesType || !checkedField(portalAccess)) {
      throw new Error("GHL package fields do not match the paid POS invoice");
    }
    if (pkg.livingPractice && !checkedField(livingPractice)) {
      throw new Error("GHL Living Practice access was not verified");
    }
    verifiedEffect = {
      classification: pkg.classification,
      seriesType: pkg.seriesType,
      sessionsRemaining: pkg.sessionsRemaining,
      portalAccess: true,
      livingPractice: !!pkg.livingPractice,
    };
  } else if (support.effect === "session_credit") {
    const target = Number(sale.fulfillment?.effectTarget?.sessionsRemaining);
    if (!Number.isSafeInteger(target) || target < 1 || Number(pkg.sessionsRemaining) !== target) {
      throw new Error("Single Session target was not checkpointed before fulfillment");
    }
    if (remaining !== target || !checkedField(portalAccess)) {
      throw new Error("GHL Single Session credit was not verified");
    }
    verifiedEffect = {
      type: "session_credit",
      sessionsAdded: support.sessionCredits,
      sessionsRemaining: target,
      portalAccess: true,
    };
  } else if (support.effect === "living_practice_access") {
    if (!checkedField(portalAccess) || !checkedField(livingPractice)) {
      throw new Error("GHL Living Practice access was not verified");
    }
    verifiedEffect = {
      type: "living_practice_access",
      portalAccess: true,
      livingPractice: true,
    };
  } else {
    throw new Error("POS sale fulfillment effect is not verifiable");
  }

  const at = now || new Date().toISOString();
  return {
    ...sale,
    fulfillmentStatus: "fulfilled",
    fulfillmentError: null,
    fulfilledAt: at,
    fulfillment: {
      ...sale.fulfillment,
      adapter: "ghl_invoice",
      stage: "verified",
      invoice: {
        ...sale.fulfillment?.invoice,
        id: invoice.id,
        number: invoice.number || sale.fulfillment?.invoice?.number || null,
        status: "paid",
        amountPaid: invoice.amountPaid,
      },
      verifiedEffect,
      verifiedAt: at,
    },
    updatedAt: at,
    version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
    audit: [
      ...(sale.audit || []),
      {
        at,
        actor,
        action: "ghl_invoice_fulfillment_verified",
        detail: `GHL invoice ${invoice.id} and ${support.effect} effect verified.`,
      },
    ],
  };
}

async function claimFulfillment(context, saleId) {
  const eventId = `pos-fulfill:${saleId}`;
  if (context.env.ATTEND_DB) {
    const claim = await claimProcessedEvent(context.env.ATTEND_DB, eventId);
    if (claim?.duplicate) return { ok: false, duplicate: true, backend: "d1", key: eventId };
    if (claim?.ok) return { ok: true, backend: "d1", key: eventId };
  }
  if (context.env.PORTAL_KV) {
    const key = `staff-pos:fulfill:${saleId}`;
    const existing = await context.env.PORTAL_KV.get(key);
    if (existing) return { ok: false, duplicate: true, backend: "kv", key };
    await context.env.PORTAL_KV.put(key, new Date().toISOString(), { expirationTtl: KV_TTL_SECONDS });
    return { ok: true, backend: "kv", key };
  }
  return { ok: true };
}

/**
 * Fulfill a fully-paid POS sale through its explicit policy. Owned no-effect
 * carts issue an immutable receipt; provider-linked package carts use the
 * temporary GHL invoice bridge. Returns { sale, result }.
 */
export async function fulfillPaidPosSale(context, sale, { actor = "POS" } = {}) {
  if (!sale || sale.status !== "paid") {
    return { sale, result: { skipped: true, reason: "not_paid" } };
  }
  if (sale.fulfillmentStatus === "fulfilled") {
    return { sale, result: { skipped: true, reason: "already_fulfilled" } };
  }
  if (ownedNoEffectCart(sale.cart)) {
    try {
      const receipt = await issueOwnedReceipt(context.env.ATTEND_DB || null, sale, { actor });
      const completedAt = receipt.issuedAt;
      const completed = {
        ...sale,
        fulfillmentStatus: "fulfilled",
        fulfillmentError: null,
        fulfilledAt: completedAt,
        fulfillment: {
          adapter: "owned_receipt",
          stage: "issued",
          effect: "none",
          receiptId: receipt.receiptId,
          issuedAt: receipt.issuedAt,
        },
        updatedAt: completedAt,
        version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
        audit: [
          ...(sale.audit || []),
          {
            at: completedAt,
            actor,
            action: "owned_receipt_issued",
            detail: `Owned receipt ${receipt.receiptId} issued. No session, access, booking, automation, or GHL effect was applied.`,
          },
        ],
      };
      return {
        sale: completed,
        result: { ok: true, pending: false, effect: "none", receiptId: receipt.receiptId },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      const failed = {
        ...sale,
        fulfillmentStatus: "failed",
        fulfillmentError: message.slice(0, 300),
        fulfillment: { adapter: "owned_receipt", stage: "failed", effect: "none" },
        updatedAt: failedAt,
        version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
        audit: [...(sale.audit || []), { at: failedAt, actor, action: "owned_receipt_failed", detail: message.slice(0, 300) }],
      };
      return { sale: failed, result: { ok: false, pending: true, reason: "owned_receipt_failed", error: message } };
    }
  }
  if ((sale.cart || []).some(ownedNoEffectLine)) {
    const message = "Owned no-effect products cannot share a cart with session or access products";
    return {
      sale: { ...sale, fulfillmentStatus: "failed", fulfillmentError: message },
      result: { ok: false, pending: true, reason: "mixed_fulfillment_policy", error: message },
    };
  }
  if (String(sale.client?.id || "").startsWith("draft_")) {
    return { sale, result: { skipped: true, reason: "draft_client" } };
  }
  if (context.env.STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED !== "true") {
    return {
      sale,
      result: {
        ok: false,
        pending: true,
        reason: "invoice_bridge_disabled",
      },
    };
  }

  const contactId = sale.client.id;
  const at = new Date().toISOString();
  const support = assessPosInvoiceSupport(sale.cart);
  if (!support.supported) {
    const message = support.reasons.join("; ");
    const needsReview = {
      ...sale,
      fulfillmentStatus: "failed",
      fulfillmentError: message.slice(0, 300),
      fulfillment: {
        adapter: "ghl_invoice",
        stage: "needs_review",
        reasons: support.reasons,
      },
      updatedAt: at,
      version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
      audit: [
        ...(sale.audit || []),
        { at, actor, action: "ghl_invoice_needs_review", detail: message.slice(0, 300) },
      ],
    };
    return {
      sale: needsReview,
      result: { ok: false, pending: true, reason: "needs_review", errors: support.reasons },
    };
  }
  if (!context.env.PORTAL_KV) {
    return {
      sale,
      result: { ok: false, pending: true, reason: "pos_storage_required" },
    };
  }

  const claim = await claimFulfillment(context, sale.id);
  if (claim.duplicate) {
    let latest = sale;
    try { latest = (await readPosSale(context.env.PORTAL_KV, sale.id)) || sale; } catch { /* preserve caller snapshot */ }
    return {
      sale: latest,
      result: { ok: false, duplicate: true, reason: "claim_held" },
    };
  }

  let checkpointSale = sale;

  try {
    const mirrored = await mirrorPaidPosSaleToGhlInvoice(context, sale, {
      onInvoiceIdentified: async (evidence) => {
        const checkpointAt = new Date().toISOString();
        checkpointSale = {
          ...sale,
          fulfillmentStatus: "pending",
          fulfillment: {
            adapter: "ghl_invoice",
            stage: evidence.stage,
            invoice: {
              id: evidence.invoiceId,
              number: evidence.invoiceNumber,
              status: evidence.invoiceStatus,
            },
            expectedEffect: evidence.effect,
          },
          updatedAt: checkpointAt,
          version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
          audit: [
            ...(sale.audit || []),
            {
              at: checkpointAt,
              actor,
              action: "ghl_invoice_identified",
              detail: `GHL invoice ${evidence.invoiceId} checkpointed before payment recording.`,
            },
          ],
        };
        await writePosSale(context.env.PORTAL_KV, checkpointSale);
      },
    });

    const completedAt = new Date().toISOString();
    const next = {
      ...checkpointSale,
      fulfillmentStatus: "pending",
      fulfillmentError: null,
      fulfillment: {
        ...checkpointSale.fulfillment,
        adapter: "ghl_invoice",
        stage: "verification_pending",
        invoice: {
          id: mirrored.invoiceId,
          number: mirrored.invoiceNumber,
          status: mirrored.invoiceStatus,
          amountPaid: mirrored.amountPaid,
        },
        expectedEffect: mirrored.effect,
      },
      updatedAt: completedAt,
      version: (Number.isInteger(checkpointSale.version) ? checkpointSale.version : 0) + 1,
      audit: [
        ...(checkpointSale.audit || []),
        {
          at: completedAt,
          actor,
          action: "ghl_invoice_payment_recorded",
          detail: `GHL invoice ${mirrored.invoiceId} is paid; downstream verification remains pending.`,
        },
      ],
    };

    context.waitUntil?.(emitPathHop(context.env, {
      pathId: "pos_card_fulfill",
      hopId: "fulfill",
      outcome: "ok",
      summary: "POS invoice paid — downstream verification pending",
      source: "staff-pos-fulfill",
      contactId,
      correlationId: sale.id ? `pos:${sale.id}` : null,
      money: sale.totals?.grandTotalCents != null
        ? { amountCents: sale.totals.grandTotalCents, product: "POS" }
        : { product: "POS" },
    }));

    return {
      sale: next,
      result: {
        ok: true,
        pending: true,
        stage: "verification_pending",
        invoiceId: mirrored.invoiceId,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[staff-pos-fulfill] ${sale.id}: ${message}`);
    context.waitUntil?.(recordOpsError(context.env, "staff-pos-fulfill",
      "POS sale paid but GHL invoice bridge failed",
      { saleId: sale.id, contactId, error: message.slice(0, 300) }));
    context.waitUntil?.(emitPathHop(context.env, {
      pathId: "pos_card_fulfill",
      hopId: "fulfill",
      outcome: "fail",
      summary: "POS paid but GHL invoice bridge failed",
      source: "staff-pos-fulfill",
      contactId,
      correlationId: sale.id ? `pos:${sale.id}` : null,
      reasonCode: "fulfill_failed",
      condition: {
        expected: "GHL invoice evidence recorded for paid POS sale",
        observed: message.slice(0, 120),
      },
    }));

    const failed = {
      ...checkpointSale,
      fulfillmentStatus: "failed",
      fulfillmentError: message.slice(0, 300),
      fulfillment: {
        ...(checkpointSale.fulfillment || {}),
        adapter: "ghl_invoice",
        stage: "failed",
        lastError: {
          message: message.slice(0, 300),
          retryable: true,
          at,
        },
      },
      updatedAt: at,
      version: (Number.isInteger(checkpointSale.version) ? checkpointSale.version : 0) + 1,
      audit: [
        ...(checkpointSale.audit || []),
        {
          at,
          actor,
          action: "ghl_fulfillment_failed",
          detail: message.slice(0, 300),
        },
      ],
    };
    // A failed attempt did not complete the protected work. Release only the
    // claim this attempt actually won so a later retry can proceed.
    if (claim.backend === "d1") {
      try { await releaseProcessedEvent(context.env.ATTEND_DB, claim.key); } catch { /* ignore */ }
    } else if (claim.backend === "kv" && context.env.PORTAL_KV) {
      try { await context.env.PORTAL_KV.delete(claim.key); } catch { /* ignore */ }
    }
    return { sale: failed, result: { ok: false, error: message } };
  }
}
