// Cloudflare Pages Function: POST /api/stripe-pos-webhook
// Stripe → Staff POS payment-leg settlement → GHL fulfillment when fully paid.

import { claimProcessedEvent } from "../lib/processed-events.js";
import { fulfillPaidPosSale } from "../lib/staff-pos-fulfill.js";
import { markLegPaid, posSessionKey, readPosSale, writePosSale } from "../lib/staff-pos.js";
import { verifyStripeWebhookSignature } from "../lib/stripe-api.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadSaleForSession(kv, session) {
  const saleId = session?.metadata?.sale_id || (await kv.get(posSessionKey(session.id)));
  if (!saleId) return null;
  return readPosSale(kv, saleId);
}

async function maybeFulfill(context, sale) {
  if (!sale || sale.status !== "paid") return sale;
  const { sale: fulfilled } = await fulfillPaidPosSale(context, sale, { actor: "Stripe" });
  await writePosSale(context.env.PORTAL_KV, fulfilled);
  return fulfilled;
}

async function settleSession(context, session, source) {
  if (!session || session.payment_status !== "paid") {
    return { skipped: true, reason: "not_paid" };
  }
  const sale = await loadSaleForSession(context.env.PORTAL_KV, session);
  if (!sale) return { skipped: true, reason: "sale_not_found" };

  const legId = session.metadata?.payment_leg_id;
  if (!legId) return { skipped: true, reason: "missing_leg" };

  const leg = sale.paymentLegs?.find((item) => item.id === legId);
  if (!leg) return { skipped: true, reason: "leg_not_found" };
  if (leg.status === "paid") {
    const refreshed = await maybeFulfill(context, sale);
    return {
      ok: true,
      duplicate: true,
      saleId: refreshed.id,
      legId,
      status: refreshed.status,
      fulfillmentStatus: refreshed.fulfillmentStatus || null,
    };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  let next = markLegPaid(sale, legId, {
    paymentIntentId,
    source,
    reviewer: "Stripe",
  });
  await writePosSale(context.env.PORTAL_KV, next);
  next = await maybeFulfill(context, next);
  return {
    ok: true,
    saleId: next.id,
    legId,
    status: next.status,
    fulfillmentStatus: next.fulfillmentStatus || null,
  };
}

export async function onRequestPost(context) {
  const secret = context.env.STRIPE_POS_WEBHOOK_SECRET || context.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-pos-webhook] webhook secret not configured");
    return json({ error: "Webhook not configured" }, 500);
  }
  if (!context.env.PORTAL_KV) {
    return json({ error: "POS storage not configured" }, 500);
  }

  const rawBody = await context.request.text();
  const signature = context.request.headers.get("Stripe-Signature") || "";
  let valid = false;
  try {
    valid = await verifyStripeWebhookSignature(rawBody, signature, secret);
  } catch (error) {
    console.error("[stripe-pos-webhook] signature setup", error instanceof Error ? error.message : error);
    return json({ error: "Webhook not configured" }, 500);
  }
  if (!valid) return json({ error: "Invalid signature" }, 400);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const eventId = typeof event.id === "string" ? event.id : "";
  if (eventId && context.env.ATTEND_DB) {
    const claim = await claimProcessedEvent(context.env.ATTEND_DB, `stripe:${eventId}`);
    if (claim && claim.duplicate) return json({ received: true, duplicate: true });
  } else if (eventId && context.env.PORTAL_KV) {
    const key = `staff-pos:stripe-event:${eventId}`;
    const existing = await context.env.PORTAL_KV.get(key);
    if (existing) return json({ received: true, duplicate: true });
    await context.env.PORTAL_KV.put(key, new Date().toISOString(), { expirationTtl: 90 * 86400 });
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const result = await settleSession(context, event.data?.object, event.type);
      return json({ received: true, ...result });
    }
    return json({ received: true, ignored: event.type });
  } catch (error) {
    console.error("[stripe-pos-webhook]", error instanceof Error ? error.message : error);
    return json({ error: "Webhook handler failed" }, 500);
  }
}
