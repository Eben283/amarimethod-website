// Cloudflare Pages Function: POST /api/ghl-invoice-webhook
//
// Handles GHL Invoice Paid events for series / upgrade purchases.
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
// 5. Classify via productId → series/upgrade bucket
// 6. If not a series/upgrade product → 200 OK, no-op
// 7. Idempotency check via KV (invoice id)
// 8. Fetch contact → read current state
// 9. PATCH custom fields: series_type, sessions_remaining (SET),
//    portal_access, living_practice_access (8-pack only)
// 10. Remove tags: discovery call attended, quiz submitted, ambassador-prospect
// 11. Add tag: invoice-series-purchased (triggers downstream cleanup workflow)
// 12. Store invoice id in KV for idempotency

import { ghlFetch, ghlHeaders, getGhlToken, applyTagDelta } from "../lib/ghl.js";
import { WEBHOOK_PURCHASE_MAP } from "../lib/ghl-products.js";
import { timingSafeEqual } from "../lib/safe-equal.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
// 90 days — must cover the replay window. Was 30d (the short outlier vs the
// reconcile worker's 90d); a package whose idempotency record expired at 30d
// could be re-credited by a later non-package invoice event (H2, 2026-06-11).
export const KV_TTL_SECONDS = 90 * 86400;

// Product allowlist — only series/upgrade purchases trigger the post-purchase
// automation. Shape: { [productId]: { name, sessionsRemaining, seriesType, livingPractice } }
// Source of truth lives in functions/lib/ghl-products.js (GHL_PRODUCTS). Any
// product marked isPackagePurchase: true is included here automatically.
// Non-package products (individual follow-ups, entrainments, retired items,
// custom line items with no productId) are a silent no-op in this webhook.
export const INVOICE_PURCHASE_PRODUCTS = WEBHOOK_PURCHASE_MAP;

// ── GHL custom field IDs (same as ghl-purchase-webhook.js) ──
const FIELD_IDS = {
  sessionsRemaining: "wrQSkx6BhXwDGIn1d0V4",
  seriesType: "3i93lTkmuAV49s9nh0q8",
  portalAccess: "O0xmwyRqeNK2EA1GGGye",
  livingPracticeAccess: "1EnVtI70jC5MTshZjWvw",
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
      if (pkg) return pkg;
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
        `[ghl-invoice-webhook] No series/upgrade invoice found for contact ${sanitizedContactId} — no-op`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "not-a-series-purchase" }),
        { status: 200, headers },
      );
    }

    const { invoice, pkg } = match;
    const matchedInvoiceId = invoice._id || invoice.id;
    console.log(
      `[ghl-invoice-webhook] Matched invoice ${matchedInvoiceId}: ${pkg.name}`,
    );

    // 4. Idempotency check via KV
    const kv = context.env.PURCHASE_KV;
    const idempotencyKey = matchedInvoiceId ? `invoice:${matchedInvoiceId}` : null;

    if (kv && idempotencyKey) {
      try {
        const existing = await kv.get(idempotencyKey);
        if (existing) {
          console.log(
            `[ghl-invoice-webhook] Invoice ${matchedInvoiceId} already processed — skipping`,
          );
          return new Response(
            JSON.stringify({ success: true, alreadyProcessed: true }),
            { status: 200, headers },
          );
        }
      } catch (err) {
        console.warn(
          `[ghl-invoice-webhook] KV read failed: ${err.message} — proceeding without idempotency check`,
        );
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

    // 6. Build field updates — SET (matching C1/C2/C1b/C2b semantics, 2026-03-29 restoration)
    const fieldUpdates = [
      { id: FIELD_IDS.sessionsRemaining, field_value: String(pkg.sessionsRemaining) },
      { id: FIELD_IDS.seriesType, field_value: pkg.seriesType },
      { id: FIELD_IDS.portalAccess, field_value: true },
    ];
    if (pkg.livingPractice) {
      fieldUpdates.push({ id: FIELD_IDS.livingPracticeAccess, field_value: true });
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
        add: existingTags.includes(DOWNSTREAM_TRIGGER_TAG)
          ? []
          : [DOWNSTREAM_TRIGGER_TAG],
        remove: TAGS_TO_REMOVE.filter((t) => existingTags.includes(t)),
      });
    } catch (err) {
      console.error(
        `[ghl-invoice-webhook] tag delta failed for ${sanitizedContactId}: ${err.message}`,
      );
      return new Response(
        JSON.stringify({ error: "Failed to apply contact tags" }),
        { status: 500, headers },
      );
    }

    console.log(
      `[ghl-invoice-webhook] Updated ${sanitizedContactId}: ${pkg.name} — series_type=${pkg.seriesType}, sessions_remaining ${currentRemaining} → ${pkg.sessionsRemaining}, series_type was ${currentSeriesType || "none"}`,
    );

    // 8. Store invoice id in KV for idempotency
    if (kv && idempotencyKey) {
      try {
        await kv.put(
          idempotencyKey,
          JSON.stringify({
            contactId: sanitizedContactId,
            invoiceId: matchedInvoiceId,
            product: pkg.name,
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
        seriesType: pkg.seriesType,
        sessionsRemaining: pkg.sessionsRemaining,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("[ghl-invoice-webhook] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers },
    );
  }
}
