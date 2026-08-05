// Staff POS → GHL fulfillment bridge.
// Runs only after a sale is fully paid. Mirrors the field-credit behavior of
// ghl-purchase-webhook / ghl-invoice-webhook (SET packages, ADD singles,
// additive 4→8 upgrade). Custom / entrainment / assessment lines are noted
// only and never grant sessions.

import { applyTagDelta, ghlFetch, ghlHeaders, getGhlToken } from "./ghl.js";
import { FIELD_IDS } from "./ghl-fields.js";
import {
  DRAW_DOWN_PRODUCT_IDS,
  GHL_PRODUCTS,
  PURCHASE_CREDIT_MAP,
} from "./ghl-products.js";
import { claimProcessedEvent, releaseProcessedEvent } from "./processed-events.js";
import { recordOpsError } from "./ops-alert.js";
import { emitPathHop } from "./ops-path-emit.js";
import { recordSeriesPurchase } from "./purchase-confirmations.js";
import { emitNurtureEvent } from "./engine-forward.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const KV_TTL_SECONDS = 90 * 86400;

const TAGS_TO_REMOVE = [
  "discovery call attended",
  "quiz submitted",
  "ambassador-prospect",
];
const PACKAGE_TRIGGER_TAG = "invoice-series-purchased";

function getCustomFieldValue(contact, fieldId) {
  if (!contact?.customFields) return null;
  const field = contact.customFields.find((f) => f.id === fieldId);
  return field ? (field.value ?? field.field_value ?? null) : null;
}

export function buildPosFulfillmentEffects(cart = []) {
  const effects = [];
  for (const line of cart) {
    const quantity = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1;
    if (line.kind === "custom" || !line.ghlProductId) {
      effects.push({ type: "note", label: line.label || "Custom sale", quantity });
      continue;
    }
    const product = GHL_PRODUCTS[line.ghlProductId];
    if (!product) {
      effects.push({ type: "note", label: line.label || line.ghlProductId, quantity });
      continue;
    }
    if (product.classification === "living-practice") {
      effects.push({ type: "living_practice", name: product.name, quantity });
      continue;
    }
    if (
      product.classification === "entrainment" ||
      product.classification === "assessment" ||
      DRAW_DOWN_PRODUCT_IDS.has(line.ghlProductId)
    ) {
      effects.push({ type: "note", label: product.name, quantity });
      continue;
    }
    const credit = PURCHASE_CREDIT_MAP[line.ghlProductId];
    if (!credit) {
      effects.push({ type: "note", label: product.name, quantity });
      continue;
    }
    if (credit.seriesType) {
      effects.push({
        type: product.isAdditive ? "add_package" : "set_package",
        productId: line.ghlProductId,
        name: credit.name,
        sessions: credit.sessionsToAdd * quantity,
        seriesType: credit.seriesType,
        livingPractice: !!credit.livingPractice,
        classification: product.classification,
      });
    } else {
      effects.push({
        type: "add_session",
        productId: line.ghlProductId,
        name: credit.name,
        sessions: credit.sessionsToAdd * quantity,
      });
    }
  }
  return effects;
}

export function computeFulfillmentFields(effects, contact) {
  let remaining = parseInt(getCustomFieldValue(contact, FIELD_IDS.sessions_remaining) ?? "0", 10) || 0;
  let seriesType = getCustomFieldValue(contact, FIELD_IDS.series_type) || null;
  let portalAccess = false;
  let livingPractice = getCustomFieldValue(contact, FIELD_IDS.living_practice_access) === true
    || getCustomFieldValue(contact, FIELD_IDS.living_practice_access) === "true";
  let packagePurchased = false;
  const notes = [];
  let primaryPackage = null;

  for (const effect of effects) {
    if (effect.type === "note") {
      notes.push(`${effect.quantity}× ${effect.label}`);
      continue;
    }
    if (effect.type === "living_practice") {
      livingPractice = true;
      portalAccess = true;
      notes.push(`${effect.quantity}× ${effect.name}`);
      continue;
    }
    if (effect.type === "set_package") {
      remaining = effect.sessions;
      seriesType = effect.seriesType;
      portalAccess = true;
      if (effect.livingPractice) livingPractice = true;
      packagePurchased = true;
      primaryPackage = effect;
      notes.push(`${effect.name} (set ${effect.sessions})`);
      continue;
    }
    if (effect.type === "add_package") {
      remaining += effect.sessions;
      seriesType = effect.seriesType;
      portalAccess = true;
      if (effect.livingPractice) livingPractice = true;
      packagePurchased = true;
      primaryPackage = effect;
      notes.push(`${effect.name} (+${effect.sessions})`);
      continue;
    }
    if (effect.type === "add_session") {
      remaining += effect.sessions;
      portalAccess = true;
      if (!seriesType || seriesType === "none") seriesType = "none";
      notes.push(`${effect.name} (+${effect.sessions})`);
    }
  }

  if (remaining < 0) remaining = 0;

  const fieldUpdates = [];
  if (portalAccess || packagePurchased || effects.some((e) => e.type === "add_session" || e.type === "living_practice")) {
    fieldUpdates.push({ id: FIELD_IDS.portal_access, field_value: true });
  }
  if (effects.some((e) => e.type === "set_package" || e.type === "add_package" || e.type === "add_session")) {
    fieldUpdates.push({ id: FIELD_IDS.sessions_remaining, field_value: String(remaining) });
  }
  if (packagePurchased && seriesType) {
    fieldUpdates.push({ id: FIELD_IDS.series_type, field_value: seriesType });
  } else if (effects.some((e) => e.type === "add_session") && (!getCustomFieldValue(contact, FIELD_IDS.series_type) || getCustomFieldValue(contact, FIELD_IDS.series_type) === "none")) {
    fieldUpdates.push({ id: FIELD_IDS.series_type, field_value: "none" });
  }
  if (livingPractice) {
    fieldUpdates.push({ id: FIELD_IDS.living_practice_access, field_value: true });
  }

  return {
    remaining,
    seriesType,
    portalAccess,
    livingPractice,
    packagePurchased,
    primaryPackage,
    fieldUpdates,
    notes,
  };
}

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

function buildSaleNote(sale, plan) {
  const lines = (sale.cart || []).map((line) => `- ${line.quantity}× ${line.label} (${money(line.lineTotalCents)})`);
  return [
    `Staff POS sale paid — ${sale.id}`,
    `Total: ${money(sale.totalCents)}`,
    `Fulfillment: ${plan.notes.join("; ") || "note only"}`,
    plan.packagePurchased ? `sessions_remaining → ${plan.remaining}; series_type → ${plan.seriesType}` : null,
    "",
    "Cart:",
    ...lines,
  ].filter((row) => row !== null).join("\n");
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

  const claim = await claimFulfillment(context, sale.id);
  if (claim.duplicate) {
    return {
      sale,
      result: { ok: false, duplicate: true, reason: "claim_held" },
    };
  }

  const effects = buildPosFulfillmentEffects(sale.cart);
  const contactId = sale.client.id;
  const at = new Date().toISOString();

  try {
    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      const errText = await contactRes.text();
      throw new Error(`Contact fetch failed (${contactRes.status}): ${String(errText).slice(0, 200)}`);
    }
    const contactPayload = await contactRes.json();
    const contact = contactPayload.contact || contactPayload;
    const plan = computeFulfillmentFields(effects, contact);

    if (plan.fieldUpdates.length) {
      const token = await getGhlToken(context);
      const updateRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        headers: ghlHeaders(token),
        body: JSON.stringify({ customFields: plan.fieldUpdates }),
      });
      if (!updateRes.ok) {
        const errText = await updateRes.text();
        throw new Error(`Field update failed (${updateRes.status}): ${String(errText).slice(0, 200)}`);
      }
    }

    if (plan.packagePurchased) {
      await applyTagDelta(context, contactId, {
        add: [PACKAGE_TRIGGER_TAG],
        remove: TAGS_TO_REMOVE,
      }).catch((err) => {
        console.warn(`[staff-pos-fulfill] tag delta failed: ${err instanceof Error ? err.message : err}`);
      });
    }

    try {
      await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: buildSaleNote(sale, plan) }),
      });
    } catch (err) {
      console.warn(`[staff-pos-fulfill] note failed: ${err instanceof Error ? err.message : err}`);
    }

    if (plan.primaryPackage) {
      emitNurtureEvent(context, {
        kind: "purchase",
        contactId,
        productId: plan.primaryPackage.productId,
      });
      await recordSeriesPurchase(context, {
        contactId,
        seriesType: plan.primaryPackage.seriesType,
        classification: plan.primaryPackage.classification,
        ref: `pos:${sale.id}`,
        source: "staff-pos",
      }, Date.now());
    }

    const next = {
      ...sale,
      fulfillmentStatus: "fulfilled",
      fulfilledAt: at,
      fulfillment: {
        remaining: plan.remaining,
        seriesType: plan.seriesType,
        notes: plan.notes,
        packagePurchased: plan.packagePurchased,
      },
      updatedAt: at,
      version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
      audit: [
        ...(sale.audit || []),
        {
          at,
          actor,
          action: "ghl_fulfilled",
          detail: plan.notes.join("; ") || "GHL note recorded; no session credit changes.",
        },
      ],
    };

    context.waitUntil?.(emitPathHop(context.env, {
      pathId: "pos_card_fulfill",
      hopId: "fulfill",
      outcome: "ok",
      summary: `POS fulfilled${plan.packagePurchased ? " · package" : ""} · remaining ${plan.remaining ?? "?"}`,
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
        remaining: plan.remaining,
        seriesType: plan.seriesType,
        packagePurchased: plan.packagePurchased,
        notes: plan.notes,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[staff-pos-fulfill] ${sale.id}: ${message}`);
    context.waitUntil?.(recordOpsError(context.env, "staff-pos-fulfill",
      "POS sale paid but GHL fulfillment failed",
      { saleId: sale.id, contactId, error: message.slice(0, 300) }));
    context.waitUntil?.(emitPathHop(context.env, {
      pathId: "pos_card_fulfill",
      hopId: "fulfill",
      outcome: "fail",
      summary: "POS paid but GHL fulfill failed",
      source: "staff-pos-fulfill",
      contactId,
      correlationId: sale.id ? `pos:${sale.id}` : null,
      reasonCode: "fulfill_failed",
      condition: {
        expected: "GHL fields updated for paid POS sale",
        observed: message.slice(0, 120),
      },
    }));

    const failed = {
      ...sale,
      fulfillmentStatus: "failed",
      fulfillmentError: message.slice(0, 300),
      updatedAt: at,
      version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
      audit: [
        ...(sale.audit || []),
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
