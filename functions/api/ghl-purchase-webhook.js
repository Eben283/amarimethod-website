// Cloudflare Pages Function: POST /api/ghl-purchase-webhook
// Backup webhook — ensures sessions_remaining gets set on every purchase,
// even if GHL's internal purchase workflows fail to fire.
//
// Triggered by: GHL outbound webhook on "Order Submitted" event.
//
// Flow:
// 1. Verify webhook secret
// 2. Extract contact ID, product ID, order ID from payload
// 3. Map product ID to package (sessions to add, series type, etc.)
// 4. Idempotency check via Cloudflare KV (skip if already processed)
// 5. Read current sessions_remaining from GHL contact
// 6. Compute new value and PUT back to GHL
// 7. Store order ID in KV to prevent duplicates
//
// Setup (manual, post-deploy):
//   1. Add GHL_WEBHOOK_SECRET env var in Cloudflare Dashboard
//   2. Create PURCHASE_KV namespace in Cloudflare and bind to Pages project
//   3. In GHL → Settings → Webhooks → "Order Submitted" event →
//      URL: https://www.amarimethod.com/api/ghl-purchase-webhook
//      Header: X-Webhook-Secret: <same value as GHL_WEBHOOK_SECRET>

import { ghlFetch, ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// ── Product-to-package mapping ──
// GHL product IDs → session increment + field values
const PRODUCT_MAP = {
  // 4-Session Series ($720)
  "69986faa724ecd2343ebaa6e": {
    name: "4-Session Series",
    sessionsToAdd: 4,
    seriesType: "4-session",
    livingPractice: false,
  },
  // 8-Session Series ($1,295)
  "69987357c839790426996114": {
    name: "8-Session Series",
    sessionsToAdd: 8,
    seriesType: "8-session",
    livingPractice: true,
  },
  // Upgrade: Initial → 4-Session ($495)
  "6998739230cc6054f9bba62d": {
    name: "Upgrade to 4-Session",
    sessionsToAdd: 3,
    seriesType: "4-session",
    livingPractice: false,
  },
  // Upgrade: Initial → 8-Session ($1,070)
  "699873d6990b71ebc1fa26b4": {
    name: "Upgrade to 8-Session",
    sessionsToAdd: 7,
    seriesType: "8-session",
    livingPractice: true,
  },
  // Single Follow-up ($190)
  "67f57171b6b1019c7b0233cc": {
    name: "Single Follow-up",
    sessionsToAdd: 1,
    seriesType: null, // Don't change series_type if client already has one
    livingPractice: false,
  },
};

// ── GHL custom field IDs ──
const FIELD_IDS = {
  sessionsRemaining: "wrQSkx6BhXwDGIn1d0V4",
  seriesType: "3i93lTkmuAV49s9nh0q8",
  portalAccess: "O0xmwyRqeNK2EA1GGGye",
  livingPracticeAccess: "1EnVtI70jC5MTshZjWvw",
};

const KV_TTL_SECONDS = 86400; // 24 hours

// Read a custom field value from a GHL contact object.
function getCustomFieldValue(contact, fieldId) {
  if (!contact.customFields) return null;
  const field = contact.customFields.find((f) => f.id === fieldId);
  return field ? (field.value ?? field.field_value ?? null) : null;
}

// Fetch the most recent order for a contact from GHL Payments API.
// Used when the webhook payload doesn't include product data.
// Returns { productId, orderId } or null.
async function fetchRecentOrder(context, contactId) {
  try {
    const url = `${GHL_API_BASE}/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=5`;
    const res = await ghlFetch(context, url);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ghl-purchase-webhook] Orders API failed (${res.status}): ${errText}`);
      return null;
    }

    const data = await res.json();
    const orders = data.data || data.orders || [];

    if (orders.length === 0) {
      console.log("[ghl-purchase-webhook] No orders found for contact via API");
      return null;
    }

    // Walk through orders (most recent first) looking for a recognized product
    for (const order of orders) {
      const items = order.items || order.lineItems || order.line_items || [];
      for (const item of items) {
        // GHL may nest the product ID under different keys
        const pid =
          item.product_id ||
          item.productId ||
          item._id ||
          item.priceId ||
          (item.price && item.price._id);
        if (pid && PRODUCT_MAP[pid]) {
          return {
            productId: pid,
            orderId: order._id || order.id || order.orderId,
          };
        }
      }
    }

    // Log what we found so we can debug product ID matching
    const firstOrder = orders[0];
    const firstItems = firstOrder.items || firstOrder.lineItems || firstOrder.line_items || [];
    console.log(
      `[ghl-purchase-webhook] No recognized products in ${orders.length} orders. First order items: ${JSON.stringify(firstItems).slice(0, 500)}`
    );
    return null;
  } catch (err) {
    console.error(`[ghl-purchase-webhook] fetchRecentOrder error: ${err.message}`);
    return null;
  }
}

// Extract a value from the webhook payload, trying multiple possible keys.
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

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  try {
    // ── 1. Verify webhook secret ──
    const expectedSecret = context.env.GHL_WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.error("[ghl-purchase-webhook] GHL_WEBHOOK_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    const providedSecret = context.request.headers.get("X-Webhook-Secret");
    if (providedSecret !== expectedSecret) {
      console.warn("[ghl-purchase-webhook] Invalid webhook secret");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers }
      );
    }

    // ── 2. Parse payload ──
    const body = await context.request.json();

    // Log full payload on first invocations for debugging field names
    console.log("[ghl-purchase-webhook] Received payload:", JSON.stringify(body).slice(0, 2000));

    const contactId = extractField(body, [
      "contact_id", "contactId", "contact.id",
      "data.contact_id", "data.contactId",
      "id",
    ]);

    const productId = extractField(body, [
      "product_id", "productId",
      "data.product_id", "data.productId",
      "items.0.product_id", "items.0.productId",
      "line_items.0.product_id",
    ]);

    const orderId = extractField(body, [
      "order_id", "orderId", "id",
      "data.order_id", "data.orderId", "data.id",
      "transaction_id", "transactionId",
    ]);

    if (!contactId) {
      console.error("[ghl-purchase-webhook] No contactId found in payload");
      return new Response(
        JSON.stringify({ error: "Missing contactId" }),
        { status: 400, headers }
      );
    }

    // ── 3. Map product to package ──
    // The GHL Custom Webhook RAW BODY can only include contact fields,
    // not order/product fields. When productId is missing from the payload,
    // we look up the contact's most recent order via the GHL Payments API.
    let resolvedProductId = productId;
    let resolvedOrderId = orderId;

    if (!resolvedProductId || !PRODUCT_MAP[resolvedProductId]) {
      console.log(`[ghl-purchase-webhook] Product ID missing or unrecognized in payload (${productId}) — querying GHL Orders API`);
      const orderLookup = await fetchRecentOrder(context, contactId);
      if (orderLookup) {
        resolvedProductId = orderLookup.productId;
        resolvedOrderId = resolvedOrderId || orderLookup.orderId;
        console.log(`[ghl-purchase-webhook] Resolved product via Orders API: ${resolvedProductId} (order: ${resolvedOrderId})`);
      } else {
        console.log("[ghl-purchase-webhook] Could not determine product from payload or API — skipping");
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "unrecognized product" }),
          { status: 200, headers }
        );
      }
    }

    const pkg = PRODUCT_MAP[resolvedProductId];
    console.log(`[ghl-purchase-webhook] Matched product: ${pkg.name} (add ${pkg.sessionsToAdd} sessions)`);

    // ── 4. Idempotency check via KV ──
    const kv = context.env.PURCHASE_KV;
    const idempotencyKey = resolvedOrderId ? `order:${resolvedOrderId}` : null;

    if (kv && idempotencyKey) {
      try {
        const existing = await kv.get(idempotencyKey);
        if (existing) {
          console.log(`[ghl-purchase-webhook] Order ${resolvedOrderId} already processed — skipping`);
          return new Response(
            JSON.stringify({ success: true, alreadyProcessed: true }),
            { status: 200, headers }
          );
        }
      } catch (err) {
        // KV read failed — proceed anyway (better to double-process than miss)
        console.warn(`[ghl-purchase-webhook] KV read failed: ${err.message} — proceeding without idempotency check`);
      }
    } else if (!kv) {
      console.warn("[ghl-purchase-webhook] PURCHASE_KV not bound — no idempotency protection");
    }

    // ── 5. Fetch contact from GHL ──
    const sanitizedContactId = contactId.trim().slice(0, 50);
    const contactRes = await ghlFetch(
      context,
      `${GHL_API_BASE}/contacts/${sanitizedContactId}`
    );

    if (!contactRes.ok) {
      console.error(`[ghl-purchase-webhook] Contact fetch failed: ${sanitizedContactId} (${contactRes.status})`);
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers }
      );
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // ── 6. Compute new sessions_remaining ──
    // Series purchases and upgrades: SET to the package value (clean reset).
    // Single follow-ups (seriesType === null): ADD to current balance.
    const currentRemaining = parseInt(
      getCustomFieldValue(contact, FIELD_IDS.sessionsRemaining) ?? "0",
      10
    ) || 0;
    const newRemaining = pkg.seriesType !== null
      ? pkg.sessionsToAdd
      : currentRemaining + pkg.sessionsToAdd;

    // ── 7. Build field updates ──
    const fieldUpdates = [
      { id: FIELD_IDS.sessionsRemaining, field_value: String(newRemaining) },
      { id: FIELD_IDS.portalAccess, field_value: true },
    ];

    // Set series_type: for single follow-ups, only set if no existing series
    if (pkg.seriesType !== null) {
      fieldUpdates.push({ id: FIELD_IDS.seriesType, field_value: pkg.seriesType });
    } else {
      // Single follow-up — only set series_type if currently "none" or empty
      const currentSeriesType = getCustomFieldValue(contact, FIELD_IDS.seriesType);
      if (!currentSeriesType || currentSeriesType === "none") {
        fieldUpdates.push({ id: FIELD_IDS.seriesType, field_value: "none" });
      }
      // Otherwise keep existing series_type
    }

    // Set living_practice_access if this package includes it
    if (pkg.livingPractice) {
      fieldUpdates.push({ id: FIELD_IDS.livingPracticeAccess, field_value: true });
    }

    // ── 8. PUT updated fields to GHL ──
    const token = await getGhlToken(context);
    const updateRes = await fetch(`${GHL_API_BASE}/contacts/${sanitizedContactId}`, {
      method: "PUT",
      headers: ghlHeaders(token),
      body: JSON.stringify({ customFields: fieldUpdates }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error(`[ghl-purchase-webhook] PUT failed for ${sanitizedContactId} (${updateRes.status}): ${errText}`);
      return new Response(
        JSON.stringify({ error: "Failed to update contact fields" }),
        { status: 500, headers }
      );
    }

    console.log(`[ghl-purchase-webhook] Updated ${sanitizedContactId}: sessions_remaining ${currentRemaining} → ${newRemaining} (${pkg.name})`);

    // ── 9. Store order ID in KV for idempotency ──
    if (kv && idempotencyKey) {
      try {
        await kv.put(idempotencyKey, JSON.stringify({
          contactId: sanitizedContactId,
          product: pkg.name,
          sessionsAdded: pkg.sessionsToAdd,
          processedAt: new Date().toISOString(),
        }), { expirationTtl: KV_TTL_SECONDS });
      } catch (err) {
        console.warn(`[ghl-purchase-webhook] KV write failed: ${err.message} — order processed but not recorded`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        contactId: sanitizedContactId,
        product: pkg.name,
        sessionsRemaining: newRemaining,
      }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error("[ghl-purchase-webhook] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
