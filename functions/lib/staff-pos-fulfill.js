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
import { readPosSale, writePosSale } from "./staff-pos.js";

const KV_TTL_SECONDS = 90 * 86400;

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
 * Fulfill a fully-paid POS sale into GHL. Idempotent on sale.id.
 * Returns { sale, result } where result explains what happened.
 */
export async function fulfillPaidPosSale(context, sale, { actor = "POS" } = {}) {
  if (!sale || sale.status !== "paid") {
    return { sale, result: { skipped: true, reason: "not_paid" } };
  }
  if (sale.fulfillmentStatus === "fulfilled") {
    return { sale, result: { skipped: true, reason: "already_fulfilled" } };
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
