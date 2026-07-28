// Cloudflare Pages Function: GET/POST /api/staff-pos-sales
// Staff POS sales + Stripe Checkout Session creation per payment leg.

import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import {
  attachCheckoutSession,
  buildInactiveTextPreview,
  buildPosSale,
  cartSummaryLabel,
  isStripeCheckoutMethod,
  markLegPaid,
  posSessionKey,
  readPosSale,
  updatePosSale,
  writePosSale,
} from "../lib/staff-pos.js";
import { fulfillPaidPosSale } from "../lib/staff-pos-fulfill.js";
import { createPosCheckoutSession, findOrCreateStripeCustomer } from "../lib/stripe-api.js";

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function saleId() {
  return `pos_${crypto.randomUUID()}`;
}

function siteOrigin(requestUrl) {
  try {
    const host = new URL(requestUrl).host;
    if (host.endsWith("amarimethod-website.pages.dev") || host.endsWith("amarimethod.com")) {
      return `https://${host}`;
    }
  } catch {
    // fall through
  }
  return "https://www.amarimethod.com";
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS") });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;
  const id = new URL(context.request.url).searchParams.get("id") || "";
  try {
    const sale = await readPosSale(context.env.PORTAL_KV, id);
    return sale ? json({ sale }, 200, headers) : json({ error: "Saved cart not found" }, 404, headers);
  } catch (error) {
    console.error("[staff-pos-sales] GET", error instanceof Error ? error.message : error);
    return json({ error: "Could not load saved cart" }, 422, headers);
  }
}

async function ensureSale(context, body, reviewer) {
  const id = typeof body.id === "string" ? body.id : "";
  if (id) {
    const existing = await readPosSale(context.env.PORTAL_KV, id);
    if (!existing) throw Object.assign(new Error("Saved cart not found"), { status: 404 });
    if (body.version !== undefined && body.version !== existing.version) {
      throw Object.assign(new Error("This cart changed elsewhere. Reload it before saving."), { status: 409 });
    }
    if (body.client && body.cart) {
      const sale = updatePosSale(existing, {
        client: body.client,
        cart: body.cart,
        paymentLegs: body.paymentLegs,
        reviewer,
      });
      await writePosSale(context.env.PORTAL_KV, sale);
      return sale;
    }
    return existing;
  }
  const sale = buildPosSale({
    id: saleId(),
    client: body.client,
    cart: body.cart,
    paymentLegs: body.paymentLegs,
    reviewer,
  });
  await writePosSale(context.env.PORTAL_KV, sale);
  return sale;
}

async function openStripeLegs(context, sale, reviewer) {
  const secret = context.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured for Checkout");
  if (String(sale.client.id || "").startsWith("draft_")) {
    throw new Error("Select an existing GHL customer before taking card or checkout-link payment");
  }

  const origin = siteOrigin(context.request.url);
  const successUrl = `${origin}/staff/pos?sale=${encodeURIComponent(sale.id)}&checkout=success`;
  const cancelUrl = `${origin}/staff/pos?sale=${encodeURIComponent(sale.id)}&checkout=cancel`;
  const customer = await findOrCreateStripeCustomer(secret, {
    email: sale.client.email,
    name: sale.client.name,
    phone: sale.client.phone,
    contactId: sale.client.id,
  });

  let next = sale;
  const opened = [];
  for (const leg of sale.paymentLegs) {
    if (!isStripeCheckoutMethod(leg.method)) continue;
    if (leg.status === "paid") continue;
    if (leg.status === "checkout_open" && leg.stripeCheckoutUrl) {
      opened.push({ legId: leg.id, url: leg.stripeCheckoutUrl, sessionId: leg.stripeCheckoutSessionId });
      continue;
    }
    const session = await createPosCheckoutSession(secret, {
      amountCents: leg.amountCents,
      productLabel: `${cartSummaryLabel(sale)} (${leg.method})`,
      saleId: sale.id,
      paymentLegId: leg.id,
      contactId: sale.client.id,
      customerId: customer.id,
      customerEmail: sale.client.email,
      successUrl,
      cancelUrl,
      legMethod: leg.method,
    });
    next = attachCheckoutSession(next, leg.id, session, reviewer);
    await context.env.PORTAL_KV.put(posSessionKey(session.id), sale.id);
    opened.push({ legId: leg.id, url: session.url, sessionId: session.id });
  }
  next = {
    ...next,
    version: (Number.isInteger(next.version) ? next.version : 0) + 1,
    status: next.status === "draft" ? "awaiting_payment" : next.status,
  };
  await writePosSale(context.env.PORTAL_KV, next);
  return { sale: next, checkouts: opened };
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  const { body, error: bodyError } = await parseJsonBody(context.request, headers);
  if (bodyError) return bodyError;
  const action = typeof body.action === "string" ? body.action : "";
  const reviewer = typeof payload?.user === "string" ? payload.user : "Staff";

  try {
    if (action === "create") {
      const sale = buildPosSale({ id: saleId(), client: body.client, cart: body.cart, paymentLegs: body.paymentLegs, reviewer });
      await writePosSale(context.env.PORTAL_KV, sale);
      return json({ sale }, 201, headers);
    }

    if (action === "start-checkout") {
      const sale = await ensureSale(context, body, reviewer);
      if (!sale.paymentLegs?.length) return json({ error: "Add a payment method before checkout" }, 400, headers);
      const result = await openStripeLegs(context, sale, reviewer);
      return json(result, 200, headers);
    }

    if (action === "record-cash") {
      const sale = await ensureSale(context, body, reviewer);
      const legId = typeof body.paymentLegId === "string" ? body.paymentLegId : sale.paymentLegs.find((leg) => leg.method === "cash" && leg.status !== "paid")?.id;
      if (!legId) return json({ error: "No cash payment leg found" }, 400, headers);
      const cashReceivedCents = Number(body.cashReceivedCents);
      const leg = sale.paymentLegs.find((item) => item.id === legId);
      if (!leg || leg.method !== "cash") return json({ error: "Cash leg not found" }, 400, headers);
      if (!Number.isSafeInteger(cashReceivedCents) || cashReceivedCents < leg.amountCents) {
        return json({ error: "Cash received must cover the cash leg amount" }, 400, headers);
      }
      const next = markLegPaid(sale, legId, {
        cashReceivedCents,
        reviewer,
        source: "cash",
      });
      await writePosSale(context.env.PORTAL_KV, next);
      if (next.status === "paid") {
        const { sale: fulfilled, result } = await fulfillPaidPosSale(context, next, { actor: reviewer });
        await writePosSale(context.env.PORTAL_KV, fulfilled);
        return json({ sale: fulfilled, fulfillment: result }, 200, headers);
      }
      return json({ sale: next }, 200, headers);
    }

    if (action === "fulfill") {
      const id = typeof body.id === "string" ? body.id : "";
      const existing = await readPosSale(context.env.PORTAL_KV, id);
      if (!existing) return json({ error: "Saved cart not found" }, 404, headers);
      if (existing.status !== "paid") return json({ error: "Sale must be fully paid before fulfillment" }, 400, headers);
      const { sale: fulfilled, result } = await fulfillPaidPosSale(context, existing, { actor: reviewer });
      await writePosSale(context.env.PORTAL_KV, fulfilled);
      return json({ sale: fulfilled, fulfillment: result }, 200, headers);
    }

    const id = typeof body.id === "string" ? body.id : "";
    const existing = await readPosSale(context.env.PORTAL_KV, id);
    if (!existing) return json({ error: "Saved cart not found" }, 404, headers);
    if (action === "save") {
      if (body.version !== undefined && body.version !== existing.version) return json({ error: "This cart changed elsewhere. Reload it before saving." }, 409, headers);
      const sale = updatePosSale(existing, { client: body.client, cart: body.cart, paymentLegs: body.paymentLegs, reviewer });
      await writePosSale(context.env.PORTAL_KV, sale);
      return json({ sale }, 200, headers);
    }
    if (action === "preview-checkout-text") {
      const result = buildInactiveTextPreview(existing, reviewer);
      await writePosSale(context.env.PORTAL_KV, result.sale);
      return json({ sale: result.sale, preview: result.preview }, 200, headers);
    }
    return json({ error: "Unknown POS action" }, 400, headers);
  } catch (error) {
    console.error("[staff-pos-sales] POST", error instanceof Error ? error.message : error);
    const status = error?.status === 404 || error?.status === 409 ? error.status : 422;
    return json({ error: error instanceof Error ? error.message : "Could not save cart" }, status, headers);
  }
}
