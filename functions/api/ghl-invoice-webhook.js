// Cloudflare Pages Function: POST /api/ghl-invoice-webhook
//
// Handles GHL Invoice Paid events for series / upgrade purchases and two
// exact Staff POS effects: Single Session credit and Living Practice access.
// Mirrors the post-purchase automation that C1/C2/C1b/C2b perform for
// payment_link orders — but for invoices, which those workflows can't see.
//
// Why this exists:
// The GHL workflows C1 (4-Session Series Purchased), C2 (8-Session Series
// Purchased), C1b (Upgrade → 4), and C2b (Upgrade → 8) all use "Order
// Submitted" triggers that only fire for /payments/orders (payment_link)
// purchases. Invoice-based series sales (common when Garrett sells a pack
// in person during a session) silently bypass every workflow: the client
// pays, but series_type, sessions_remaining, portal_access, etc. are never
// set. Diagnosed 2026-04-10 via ghl-fix-advisor investigation of Danny
// Blumrich's INV-000030 8-pack. See GHL-WORKFLOWS-MASTER.md Section C
// "KNOWN GAP" block and open-todos.md CRITICAL section.
//
// Trigger setup (GHL):
//   Settings → Automation → Workflows → New Workflow
//   Trigger: Invoice, Invoice Status = Paid
//   Action: Webhook
//     URL: https://www.amarimethod.com/api/ghl-invoice-webhook
//     Header: X-Webhook-Secret: <GHL_WEBHOOK_SECRET value>
//     Method: POST
//     Body: include contact_id (and ideally invoice_id if available)
//
// Flow:
// 1. Verify webhook secret
// 2. Extract contact id (and invoice id if present) from payload
// 3. Fetch the contact's recent paid invoices from GHL
// 4. Identify the matching invoice (by id if known, else most recent paid)
// 5. Classify via productId → supported fulfillment effect
// 6. If unsupported → 200 OK, no-op
// 7. Idempotency check via KV (invoice id)
// 8. Fetch contact → read current state
// 9. PUT the exact idempotent custom-field effect
// 10. Remove tags: discovery call attended, quiz submitted, ambassador-prospect
// 11. Add tag: invoice-series-purchased (triggers downstream cleanup workflow)
// 12. Store invoice id in KV for idempotency

import { ghlFetch, ghlHeaders, getGhlToken, applyTagDelta } from "../lib/ghl.js";
import { recordSeriesPurchase } from "../lib/purchase-confirmations.js";
import { WEBHOOK_PURCHASE_MAP, GHL_PRODUCTS } from "../lib/ghl-products.js";
import { emitNurtureEvent } from "../lib/engine-forward.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../lib/ghl-fields.js";
import { timingSafeEqual } from "../lib/safe-equal.js";
import { claimProcessedEvent, releaseProcessedEvent } from "../lib/processed-events.js";
import { recordOpsError } from "../lib/ops-alert.js";
import { emitPathHop } from "../lib/ops-path-emit.js";
import { completeVerifiedPosSale } from "../lib/staff-pos-fulfill.js";
import { readPosSale, writePosSale } from "../lib/staff-pos.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
// 90 days — must cover the replay window. Was 30d (the short outlier vs the
// reconcile worker's 90d); a package whose idempotency record expired at 30d
// could be re-credited by a later non-package invoice event (H2, 2026-06-11).
export const KV_TTL_SECONDS = 90 * 86400;

// General invoice allowlist — only series/upgrade purchases trigger the
// post-purchase automation. Staff POS-only effects are separately allowlisted
// below and require the immutable Staff POS sale marker on the invoice.
// Source of truth lives in functions/lib/ghl-products.js (GHL_PRODUCTS). Any
// product marked isPackagePurchase: true is included here automatically.
// Non-package products (individual follow-ups, entrainments, retired items,
// custom line items with no productId) are a silent no-op in this webhook.
export const INVOICE_PURCHASE_PRODUCTS = WEBHOOK_PURCHASE_MAP;

const STAFF_POS_INVOICE_EFFECTS = Object.freeze({
  "6a6b8bb7a1753b65945372f1": {
    name: "Single Session",
    classification: "followup",
    effect: "session_credit",
    sessionsToAdd: 1,
  },
  "6998d7f2606fa79c54fa3ff5": {
    name: "Living Practice",
    classification: "living-practice",
    effect: "living_practice_access",
  },
});

// ── GHL custom field IDs (single-sourced from lib/ghl-fields.js) ──
const FIELD_IDS = {
  sessionsRemaining: GHL_FIELD_IDS.sessions_remaining,
  seriesType: GHL_FIELD_IDS.series_type,
  portalAccess: GHL_FIELD_IDS.portal_access,
  livingPracticeAccess: GHL_FIELD_IDS.living_practice_access,
};

// Tags that get removed when a series is purchased (discovery/quiz/ambassador
// leads shouldn't stay tagged as leads after buying a pack).
const TAGS_TO_REMOVE = [
  "discovery call attended",
  "quiz submitted",
  "ambassador-prospect",
];

// Tag added after successful series automation — triggers the downstream
// GHL cleanup workflow that sends the confirmation email, cancels the
// Post-Initial Upgrade Offer wait, and self-cleans this tag.
const DOWNSTREAM_TRIGGER_TAG = "invoice-series-purchased";

// ── Pure helpers ──

// Look up a product classification by id. Returns null for unknown products.
export function classifyInvoiceProduct(productId) {
  if (!productId) return null;
  return INVOICE_PURCHASE_PRODUCTS[productId] || null;
}

// Read a custom field value from a GHL contact object.
function getCustomFieldValue(contact, fieldId) {
  if (!contact || !contact.customFields) return null;
  const field = contact.customFields.find((f) => f.id === fieldId);
  return field ? (field.value ?? field.field_value ?? null) : null;
}

// Extract the matching invoice from a list of a contact's invoices.
// Returns { invoice, pkg } for the first one we can classify, else null.
//
// preferredInvoiceId matches against either the database _id / id (hex string)
// OR the human-readable invoiceNumber / number (like "INV-000030") — GHL's
// webhook merge tags expose the number, not the _id.
export function selectSeriesInvoice(invoices, preferredInvoiceId = null) {
  if (!Array.isArray(invoices) || invoices.length === 0) return null;

  // Scan all line items of an invoice for a package product — not just
  // items[0]. Pre-this-fix: only items[0] was checked, so a multi-product
  // invoice with the package at index 1+ would silently classify as
  // non-package and skip. 2026-06-03 audit finding.
  const findPackageInInvoice = (inv) => {
    const items = inv.invoiceItems || [];
    for (const item of items) {
      const pid = item?.productId || null;
      const pkg = classifyInvoiceProduct(pid);
      if (pkg) return { ...pkg, effect: "package" };
      const posEffect = posSaleIdFromInvoice(inv) ? STAFF_POS_INVOICE_EFFECTS[pid] : null;
      const quantity = Number(item?.qty ?? item?.quantity ?? 1);
      if (posEffect && quantity === 1) return posEffect;
    }
    return null;
  };

  if (preferredInvoiceId) {
    const match = invoices.find((inv) => {
      return (
        inv._id === preferredInvoiceId ||
        inv.id === preferredInvoiceId ||
        inv.invoiceNumber === preferredInvoiceId ||
        inv.number === preferredInvoiceId
      );
    });
    if (match) {
      const status = String(match.status || "").toLowerCase();
      if (status !== "paid" || Number(match.amountPaid || 0) <= 0) return null;
      const pkg = findPackageInInvoice(match);
      if (pkg) return { invoice: match, pkg };
      // H2 (2026-06-11 review): the webhook is about THIS invoice and it isn't a
      // package (e.g. a $90 Entrainment). Do NOT fall through to the history
      // scan — that re-credits an old package whose idempotency record has
      // expired, resetting sessions_remaining to full. Credit nothing.
      return null;
    }
    // preferredInvoiceId was given but not found in the list (id-format mismatch
    // / pagination) — fall through to the history scan as a resilience path.
  }

  // Otherwise scan all paid invoices most-recent-first looking for a series/upgrade.
  const paid = invoices
    .filter((inv) => (inv.status || "").toLowerCase() === "paid")
    .filter((inv) => Number(inv.amountPaid || 0) > 0)
    .sort((a, b) => {
      const da = new Date(a.issueDate || a.updatedAt || a.createdAt || 0).getTime();
      const db = new Date(b.issueDate || b.updatedAt || b.createdAt || 0).getTime();
      return db - da;
    });

  for (const inv of paid) {
    const pkg = findPackageInInvoice(inv);
    if (pkg) return { invoice: inv, pkg };
  }

  return null;
}

export function posSaleIdFromInvoice(invoice) {
  const searchable = [invoice?.name, invoice?.title, invoice?.termsNotes]
    .filter((value) => typeof value === "string")
    .join(" ");
  return searchable.match(/\bpos_[a-z0-9-]{8,80}\b/i)?.[0] || null;
}

// Try multiple possible field names on a webhook payload.
function extractField(body, keys) {
  for (const key of keys) {
    const parts = key.split(".");
    let val = body;
    for (const part of parts) {
      if (val == null || typeof val !== "object") {
        val = undefined;
        break;
      }
      val = val[part];
    }
    if (val != null && val !== "") return String(val);
  }
  return null;
}

// ── Handler ──

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };
  let wonD1ClaimKey = null;
  const releaseWonD1Claim = async () => {
    if (!wonD1ClaimKey) return;
    const key = wonD1ClaimKey;
    wonD1ClaimKey = null;
    try {
      await releaseProcessedEvent(context.env.ATTEND_DB, key);
    } catch (releaseError) {
      console.error(`[ghl-invoice-webhook] Failed to release D1 claim ${key}: ${releaseError?.message || releaseError}`);
    }
  };

  try {
    // 1. Verify webhook secret
    const expectedSecret = context.env.GHL_WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.error("[ghl-invoice-webhook] GHL_WEBHOOK_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers },
      );
    }
    const providedSecret = context.request.headers.get("X-Webhook-Secret");
    if (!timingSafeEqual(providedSecret || "", expectedSecret)) {
      console.warn("[ghl-invoice-webhook] Invalid webhook secret");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers },
      );
    }

    // 2. Parse payload
    const body = await context.request.json();
    console.log(
      "[ghl-invoice-webhook] Received payload:",
      JSON.stringify(body).slice(0, 2000),
    );

    const contactId = extractField(body, [
      "contact_id",
      "contactId",
      "contact.id",
      "data.contact_id",
      "data.contactId",
      "contactDetails.id",
    ]);
    const invoiceId = extractField(body, [
      "invoice_id",
      "invoiceId",
      "id",
      "_id",
      "data.invoice_id",
      "data.id",
      "data._id",
    ]);

    if (!contactId) {
      console.error("[ghl-invoice-webhook] No contactId found in payload");
      return new Response(
        JSON.stringify({ error: "Missing contactId" }),
        { status: 400, headers },
      );
    }

    // 3. Fetch the contact's recent invoices and select the matching one
    const sanitizedContactId = contactId.trim().slice(0, 50);
    const invoicesUrl = `${GHL_API_BASE}/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${sanitizedContactId}&limit=100&offset=0`;
    const invoicesRes = await ghlFetch(context, invoicesUrl);

    if (!invoicesRes.ok) {
      const errText = await invoicesRes.text();
      console.error(
        `[ghl-invoice-webhook] Invoices fetch failed (${invoicesRes.status}): ${errText}`,
      );
      return new Response(
        JSON.stringify({ error: "Failed to fetch invoices" }),
        { status: 500, headers },
      );
    }

    const invoicesData = await invoicesRes.json();
    const invoices = invoicesData.invoices || [];
    const match = selectSeriesInvoice(invoices, invoiceId);

    if (!match) {
      console.log(
        `[ghl-invoice-webhook] No supported invoice fulfillment found for contact ${sanitizedContactId} — no-op`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "unsupported-invoice-product" }),
        { status: 200, headers },
      );
    }

    const { invoice, pkg: matchedProduct } = match;
    const pkg = { ...matchedProduct };
    const matchedInvoiceId = invoice._id || invoice.id;
    const posSaleId = posSaleIdFromInvoice(invoice);
    console.log(
      `[ghl-invoice-webhook] Matched invoice ${matchedInvoiceId}: ${pkg.name}`,
    );

    // 4. Idempotency check
    // Primary: D1 atomic INSERT — race-safe. Fallback to KV when D1 not bound
    // (test environments, local dev). See functions/lib/processed-events.js.
    const kv = context.env.PURCHASE_KV;
    const idempotencyKey = matchedInvoiceId ? `invoice:${matchedInvoiceId}` : null;
    let usedD1 = false;
    let invoiceClaimDuplicate = false;

    if (idempotencyKey) {
      try {
        const claim = await claimProcessedEvent(context.env.ATTEND_DB, idempotencyKey);
        if (claim !== null) {
          usedD1 = true;
          if (!claim.ok) {
            if (!posSaleId) {
              console.log(`[ghl-invoice-webhook] Invoice ${matchedInvoiceId} already processed (D1) — skipping`);
              return new Response(
                JSON.stringify({ success: true, alreadyProcessed: true }),
                { status: 200, headers },
              );
            }
            // POS invoices are safe to replay: their field writes are SETs,
            // or use a previously checkpointed Single Session target. The
            // message-trigger tag is suppressed, and replay closes a crash
            // window between provider fulfillment and POS sale completion.
            invoiceClaimDuplicate = true;
            console.warn(`[ghl-invoice-webhook] Replaying processed POS invoice ${matchedInvoiceId} to verify sale ${posSaleId}`);
          }
          if (claim.ok) {
            wonD1ClaimKey = idempotencyKey;
            console.log(`[ghl-invoice-webhook] D1 claim won for invoice ${matchedInvoiceId}`);
          }
        }
      } catch (err) {
        console.warn(`[ghl-invoice-webhook] D1 idempotency failed: ${err.message} — falling back to KV`);
      }
    }

    if (!usedD1 && kv && idempotencyKey) {
      try {
        const existing = await kv.get(idempotencyKey);
        if (existing) {
          if (!posSaleId) {
            console.log(`[ghl-invoice-webhook] Invoice ${matchedInvoiceId} already processed (KV) — skipping`);
            return new Response(
              JSON.stringify({ success: true, alreadyProcessed: true }),
              { status: 200, headers },
            );
          }
          invoiceClaimDuplicate = true;
          console.warn(`[ghl-invoice-webhook] Replaying KV-processed POS invoice ${matchedInvoiceId} to verify sale ${posSaleId}`);
        }
      } catch (err) {
        console.warn(`[ghl-invoice-webhook] KV read failed: ${err.message} — proceeding without idempotency check`);
      }
    }

    // 5. Fetch contact to read current state (for logging + optional guards)
    const contactRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${sanitizedContactId}`,
    );
    if (!contactRes.ok) {
      console.error(
        `[ghl-invoice-webhook] Contact fetch failed: ${sanitizedContactId} (${contactRes.status})`,
      );
      context.waitUntil(recordOpsError(context.env, "ghl-invoice-webhook",
        "Contact fetch failed after invoice — product effect not updated",
        { contactId: sanitizedContactId, status: contactRes.status, invoiceId: matchedInvoiceId }));
      await releaseWonD1Claim();
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers },
      );
    }
    const contact = (await contactRes.json()).contact;
    const currentSeriesType = getCustomFieldValue(contact, FIELD_IDS.seriesType);
    const currentRemaining = parseInt(
      getCustomFieldValue(contact, FIELD_IDS.sessionsRemaining) ?? "0",
      10,
    ) || 0;

    let posSale = null;
    if (posSaleId) {
      if (!context.env.PORTAL_KV) throw new Error("PORTAL_KV is required to complete a Staff POS invoice");
      posSale = await readPosSale(context.env.PORTAL_KV, posSaleId);
      if (!posSale) throw new Error(`Staff POS sale ${posSaleId} was not found for invoice fulfillment`);
      if (posSale.fulfillmentStatus === "fulfilled") {
        return new Response(JSON.stringify({
          success: true,
          alreadyProcessed: true,
          contactId: sanitizedContactId,
          invoiceId: matchedInvoiceId,
          product: pkg.name,
          posSaleId,
          posFulfilled: true,
        }), { status: 200, headers });
      }
      if (pkg.effect === "session_credit" && invoiceClaimDuplicate) {
        const checkpointedTarget = Number(posSale.fulfillment?.effectTarget?.sessionsRemaining);
        if (!Number.isSafeInteger(checkpointedTarget) || checkpointedTarget < 1) {
          return new Response(JSON.stringify({
            success: false,
            pending: true,
            retryable: true,
            reason: "single-session-target-not-yet-visible",
            invoiceId: matchedInvoiceId,
            posSaleId,
          }), { status: 202, headers });
        }
      }
    }

    // 6. Build the exact idempotent field effect. Package and access writes are
    // SETs. Single Session is additive only while planning: its target balance
    // is checkpointed on the sale before the remote write, so any replay SETs
    // the same target instead of adding a second credit.
    let fieldUpdates;
    if (pkg.effect === "session_credit") {
      const checkpointedTarget = Number(posSale?.fulfillment?.effectTarget?.sessionsRemaining);
      const target = Number.isSafeInteger(checkpointedTarget) && checkpointedTarget >= 1
        ? checkpointedTarget
        : currentRemaining + Number(pkg.sessionsToAdd || 0);
      if (!Number.isSafeInteger(target) || target < 1) throw new Error("Single Session target balance is invalid");
      pkg.sessionsRemaining = target;
      fieldUpdates = [
        { id: FIELD_IDS.sessionsRemaining, field_value: String(target) },
        { id: FIELD_IDS.portalAccess, field_value: true },
      ];
      if (!Number.isSafeInteger(checkpointedTarget) || checkpointedTarget !== target) {
        const checkpointAt = new Date().toISOString();
        posSale = {
          ...posSale,
          fulfillmentStatus: "pending",
          fulfillment: {
            ...(posSale.fulfillment || {}),
            adapter: "ghl_invoice",
            stage: "effect_target_checkpointed",
            invoice: {
              ...(posSale.fulfillment?.invoice || {}),
              id: matchedInvoiceId,
              status: "paid",
            },
            effectTarget: { type: "session_credit", sessionsRemaining: target },
          },
          updatedAt: checkpointAt,
          version: (Number.isInteger(posSale.version) ? posSale.version : 0) + 1,
          audit: [
            ...(posSale.audit || []),
            {
              at: checkpointAt,
              actor: "GHL invoice webhook",
              action: "single_session_target_checkpointed",
              detail: `Single Session target balance ${target} checkpointed before contact write.`,
            },
          ],
        };
        await writePosSale(context.env.PORTAL_KV, posSale);
      }
    } else if (pkg.effect === "living_practice_access") {
      fieldUpdates = [
        { id: FIELD_IDS.portalAccess, field_value: true },
        { id: FIELD_IDS.livingPracticeAccess, field_value: true },
      ];
    } else {
      fieldUpdates = [
        { id: FIELD_IDS.sessionsRemaining, field_value: String(pkg.sessionsRemaining) },
        { id: FIELD_IDS.seriesType, field_value: pkg.seriesType },
        { id: FIELD_IDS.portalAccess, field_value: true },
      ];
      if (pkg.livingPractice) {
        fieldUpdates.push({ id: FIELD_IDS.livingPracticeAccess, field_value: true });
      }
    }

    // 7. PUT updated custom fields to GHL.
    //    IMPORTANT: never send a `tags` field on this PUT — GHL replaces the
    //    whole tag array, which would clobber tags a concurrent workflow set
    //    (and GHL triggers are tag-driven). Tags are applied additively in 7b.
    const token = await getGhlToken(context);
    const updateRes = await fetch(
      `${GHL_API_BASE}/contacts/${sanitizedContactId}`,
      {
        method: "PUT",
        headers: ghlHeaders(token),
        body: JSON.stringify({
          customFields: fieldUpdates,
        }),
      },
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(
        `[ghl-invoice-webhook] PUT failed for ${sanitizedContactId} (${updateRes.status}): ${errText}`,
      );
      context.waitUntil(recordOpsError(context.env, "ghl-invoice-webhook",
        "GHL field update failed — invoice paid, product effect not updated",
        { contactId: sanitizedContactId, status: updateRes.status, product: pkg.name,
          invoiceId: matchedInvoiceId, attemptedEffect: pkg.effect,
          attemptedRemaining: pkg.sessionsRemaining,
          ghlError: String(errText).slice(0, 300) }));
      await releaseWonD1Claim();
      return new Response(
        JSON.stringify({ error: "Failed to update contact" }),
        { status: 500, headers },
      );
    }

    // 7b. Apply tag changes additively (only the tags we own), so concurrent
    //     workflow tag writes survive. Safe to retry: add of a present tag /
    //     remove of an absent tag are no-ops.
    const existingTags = Array.isArray(contact.tags) ? contact.tags : [];
    try {
      await applyTagDelta(context, sanitizedContactId, {
        // Staff POS has a hard no-surprise-message gate. This tag starts the
        // published Invoice Series Purchase Notification workflow, so a POS
        // invoice must never add it.
        add: posSaleId || existingTags.includes(DOWNSTREAM_TRIGGER_TAG)
          ? []
          : [DOWNSTREAM_TRIGGER_TAG],
        remove: TAGS_TO_REMOVE.filter((t) => existingTags.includes(t)),
      });
    } catch (err) {
      console.error(
        `[ghl-invoice-webhook] tag delta failed for ${sanitizedContactId}: ${err.message}`,
      );
      context.waitUntil(recordOpsError(context.env, "ghl-invoice-webhook",
        "Tag delta failed — balance updated but downstream trigger tag NOT applied (workflows may not fire)",
        { contactId: sanitizedContactId, invoiceId: matchedInvoiceId,
          message: String(err && err.message).slice(0, 300) }));
      await releaseWonD1Claim();
      return new Response(
        JSON.stringify({ error: "Failed to apply contact tags" }),
        { status: 500, headers },
      );
    }

    let completedPosSale = null;
    if (posSaleId) {
      // A successful PUT response is not the proof boundary. Read the contact
      // again and compare the exact product effect before marking the Staff
      // sale fulfilled.
      const verifyContactResponse = await ghlFetch(
        context,
        `${GHL_API_BASE}/contacts/${sanitizedContactId}`,
      );
      if (!verifyContactResponse.ok) {
        throw new Error(`POS fulfillment contact readback failed (${verifyContactResponse.status})`);
      }
      const verifiedContact = (await verifyContactResponse.json()).contact;
      posSale = await readPosSale(context.env.PORTAL_KV, posSaleId);
      if (!posSale) throw new Error(`Staff POS sale ${posSaleId} was not found for invoice verification`);
      completedPosSale = completeVerifiedPosSale(posSale, {
        invoice: {
          id: matchedInvoiceId,
          number: invoice.invoiceNumber || invoice.number || null,
          amountPaid: Number(invoice.amountPaid || 0),
        },
        pkg,
        contact: verifiedContact,
      });
      await writePosSale(context.env.PORTAL_KV, completedPosSale);
      await emitPathHop(context.env, {
        pathId: "pos_card_fulfill",
        hopId: "fulfill",
        outcome: "ok",
        summary: `POS sale fulfilled from verified GHL invoice ${matchedInvoiceId}`,
        source: "ghl-invoice-webhook",
        contactId: sanitizedContactId,
        correlationId: `pos:${posSaleId}`,
        money: { product: pkg.name },
      });
    }

    // Purchase event → nurture engine (Flow 3 exit). The invoice item may carry a price-id
    // alias, so emit the CANONICAL product id derived from the package classification.
    // Fire-and-forget, dormant until the worker URL exists.
    const canonicalProductId = Object.keys(GHL_PRODUCTS)
      .find((id) => GHL_PRODUCTS[id].classification === pkg.classification) || null;
    if (canonicalProductId && !posSaleId) {
      emitNurtureEvent(context, { kind: "purchase", contactId: sanitizedContactId, productId: canonicalProductId });
    }

    // ── 7c. Purchase-cluster seam (NON-BLOCKING — GHL exit Unit C) ──
    // Invoice-based series purchases historically left the Post-Initial Upgrade Offer wait
    // running (the KNOWN GAP the invoice-series-purchased tag round-trip was built to close);
    // the code-side timer cancels here directly, plus the confirmation record (shadow:
    // would_send only). No-ops without AUTOMATION_DB; never throws.
    if (pkg.seriesType && !posSaleId) {
      const seam = await recordSeriesPurchase(context, {
        contactId: sanitizedContactId,
        seriesType: pkg.seriesType,
        classification: pkg.classification,
        ref: `invoice:${matchedInvoiceId}`,
        source: "invoice-webhook",
      }, Date.now());
      if (!seam.ok) {
        console.error(`[ghl-invoice-webhook] purchase-cluster seam failed (non-fatal): ${seam.error}`);
      }
    }

    const effectSummary = pkg.effect === "living_practice_access"
      ? "portal_access=true, living_practice_access=true"
      : pkg.effect === "session_credit"
        ? `sessions_remaining ${currentRemaining} → ${pkg.sessionsRemaining}; series_type preserved as ${currentSeriesType || "none"}`
        : `series_type=${pkg.seriesType}, sessions_remaining ${currentRemaining} → ${pkg.sessionsRemaining}`;
    console.log(`[ghl-invoice-webhook] Updated ${sanitizedContactId}: ${pkg.name} — ${effectSummary}`);

    if (!posSaleId) try {
      const corr = `invoice:${matchedInvoiceId}`;
      const label = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim() || null;
      await emitPathHop(context.env, {
        pathId: "invoice_package_credit",
        hopId: "invoice_webhook",
        outcome: "ok",
        summary: `Invoice paid — ${pkg.name}`,
        source: "ghl-invoice-webhook",
        contactId: sanitizedContactId,
        personLabel: label,
        correlationId: corr,
        money: { product: pkg.name },
      });
      await emitPathHop(context.env, {
        pathId: "invoice_package_credit",
        hopId: "put_session_fields",
        outcome: "ok",
        summary: effectSummary,
        source: "ghl-invoice-webhook",
        contactId: sanitizedContactId,
        personLabel: label,
        correlationId: corr,
        money: { product: pkg.name },
      });
      await emitPathHop(context.env, {
        pathId: "invoice_package_credit",
        hopId: "tag_delta",
        outcome: "ok",
        summary: "Invoice series tags applied",
        source: "ghl-invoice-webhook",
        contactId: sanitizedContactId,
        personLabel: label,
        correlationId: corr,
      });
    } catch (opsErr) {
      console.error("[ghl-invoice-webhook] ops emit failed:", opsErr?.message || opsErr);
    }

    // 8. KV write for idempotency — written even on a D1 win, mirroring
    // ghl-purchase-webhook (cross-system readers see KV, not D1).
    if (kv && idempotencyKey) {
      try {
        await kv.put(
          idempotencyKey,
          JSON.stringify({
            contactId: sanitizedContactId,
            invoiceId: matchedInvoiceId,
            product: pkg.name,
            effect: pkg.effect,
            sessionsRemaining: pkg.sessionsRemaining,
            processedAt: new Date().toISOString(),
          }),
          { expirationTtl: KV_TTL_SECONDS },
        );
      } catch (err) {
        console.warn(
          `[ghl-invoice-webhook] KV write failed: ${err.message} — invoice processed but not recorded`,
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        contactId: sanitizedContactId,
        invoiceId: matchedInvoiceId,
        product: pkg.name,
        effect: pkg.effect,
        seriesType: pkg.seriesType,
        sessionsRemaining: pkg.sessionsRemaining,
        posSaleId,
        posFulfilled: completedPosSale?.fulfillmentStatus === "fulfilled",
      }),
      { status: 200, headers },
    );
  } catch (err) {
    await releaseWonD1Claim();
    console.error("[ghl-invoice-webhook] Unexpected error:", err);
    context.waitUntil(recordOpsError(context.env, "ghl-invoice-webhook",
      "Unhandled error processing an invoice webhook",
      { message: String(err && err.message).slice(0, 300) }));
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers },
    );
  }
}
