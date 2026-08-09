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
import { ownedNoEffectCart, ownedNoEffectLine } from "../lib/staff-pos-receipts.js";
import { listStaffProducts, posCatalogFromProducts } from "../lib/staff-products.js";
import {
  chargeCustomerCard,
  createPosCheckoutSession,
  findOrCreateStripeCustomer,
  resolveProvenStripeCustomer,
  retrievePaymentMethod,
} from "../lib/stripe-api.js";

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

const POS_PAYMENT_ACTIONS = new Set([
  "start-checkout",
  "charge-saved-card",
  "record-cash",
  "fulfill",
]);

export function posPaymentActionAvailable(env, action, sale) {
  if (!POS_PAYMENT_ACTIONS.has(action)) return true;
  if (ownedNoEffectCart(sale?.cart)) return !!env?.ATTEND_DB;
  if ((sale?.cart || []).some(ownedNoEffectLine)) return false;
  return env?.STAFF_POS_GHL_INVOICE_BRIDGE_ENABLED === "true";
}

function unavailablePaymentResponse(headers) {
  return json({
    error: "POS payments are temporarily disabled while fulfillment is being verified.",
    code: "pos_fulfillment_not_ready",
  }, 409, headers);
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

async function storedCustomerId(env, contactId) {
  const kv = env.PURCHASE_KV || env.PORTAL_KV;
  if (!kv || !contactId) return null;
  try {
    return await kv.get(`stripe-cust:${contactId}`);
  } catch {
    return null;
  }
}

async function rememberCustomer(env, contactId, customerId) {
  const kv = env.PURCHASE_KV || env.PORTAL_KV;
  if (!kv || !contactId || !customerId) return;
  try {
    await kv.put(`stripe-cust:${contactId}`, customerId);
  } catch {
    // fail-soft
  }
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

async function ensureSale(context, body, reviewer, catalog) {
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
        catalog,
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
    catalog,
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
  await rememberCustomer(context.env, sale.client.id, customer.id);

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

async function chargeSavedCardLeg(context, sale, reviewer, { paymentMethodId, paymentLegId, confirmed }) {
  if (confirmed !== true) {
    throw Object.assign(new Error("Confirm the card-on-file charge before continuing."), { status: 400 });
  }
  const secret = context.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured for card-on-file charges");
  if (String(sale.client.id || "").startsWith("draft_")) {
    throw new Error("Select an existing GHL customer before charging a card on file");
  }
  if (typeof paymentMethodId !== "string" || !paymentMethodId.startsWith("pm_")) {
    throw Object.assign(new Error("Pick a saved card to charge."), { status: 400 });
  }

  const leg =
    (paymentLegId && sale.paymentLegs.find((item) => item.id === paymentLegId)) ||
    sale.paymentLegs.find((item) => item.method === "saved-card" && item.status !== "paid") ||
    sale.paymentLegs.find((item) => item.status !== "paid");
  if (!leg) throw Object.assign(new Error("No unpaid payment portion found"), { status: 400 });
  if (leg.status === "paid") throw Object.assign(new Error("That payment portion is already paid"), { status: 400 });

  const stored = await storedCustomerId(context.env, sale.client.id);
  const customer = await resolveProvenStripeCustomer(secret, {
    contactId: sale.client.id,
    storedCustomerId: stored,
  });
  if (!customer) {
    throw Object.assign(
      new Error("No proven Stripe customer for this contact. Use Card (Checkout) once so the card can be saved."),
      { status: 400 },
    );
  }
  await rememberCustomer(context.env, sale.client.id, customer.id);

  const pm = await retrievePaymentMethod(secret, paymentMethodId);
  if (!pm || pm.customer !== customer.id || pm.type !== "card") {
    throw Object.assign(new Error("That saved card does not belong to this customer."), { status: 400 });
  }

  let intent;
  try {
    intent = await chargeCustomerCard(secret, {
      amountCents: leg.amountCents,
      customerId: customer.id,
      paymentMethodId,
      saleId: sale.id,
      paymentLegId: leg.id,
      contactId: sale.client.id,
      description: `${cartSummaryLabel(sale)} (saved card)`,
    });
  } catch (error) {
    const code = error?.stripe?.code || "";
    if (code === "authentication_required" || /authenticate|requires.?action/i.test(error?.message || "")) {
      throw Object.assign(
        new Error("This card needs the customer present (3-D Secure). Use Card (Checkout) instead."),
        { status: 422 },
      );
    }
    throw error;
  }

  if (intent.status === "requires_action" || intent.status === "requires_confirmation") {
    throw Object.assign(
      new Error("This card needs the customer present (3-D Secure). Use Card (Checkout) instead."),
      { status: 422 },
    );
  }
  if (intent.status !== "succeeded") {
    throw Object.assign(
      new Error(`Card charge did not succeed (${intent.status || "unknown"}). Try Checkout or another method.`),
      { status: 422 },
    );
  }

  let next = markLegPaid(sale, leg.id, {
    paymentIntentId: intent.id,
    reviewer,
    source: "saved-card",
  });
  await writePosSale(context.env.PORTAL_KV, next);
  if (next.status === "paid") {
    const { sale: fulfilled, result } = await fulfillPaidPosSale(context, next, { actor: reviewer });
    await writePosSale(context.env.PORTAL_KV, fulfilled);
    return {
      sale: fulfilled,
      fulfillment: result,
      card: {
        brand: pm.card?.brand || "card",
        last4: pm.card?.last4 || "",
      },
    };
  }
  return {
    sale: next,
    card: {
      brand: pm.card?.brand || "card",
      last4: pm.card?.last4 || "",
    },
  };
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
  const productList = await listStaffProducts(context.env.ATTEND_DB || null);
  const catalog = posCatalogFromProducts(productList.products);

  try {
    if (action === "create") {
      const sale = buildPosSale({ id: saleId(), client: body.client, cart: body.cart, paymentLegs: body.paymentLegs, reviewer, catalog });
      await writePosSale(context.env.PORTAL_KV, sale);
      return json({ sale }, 201, headers);
    }

    if (action === "start-checkout") {
      const sale = await ensureSale(context, body, reviewer, catalog);
      if (!posPaymentActionAvailable(context.env, action, sale)) return unavailablePaymentResponse(headers);
      if (!sale.paymentLegs?.length) return json({ error: "Add a payment method before checkout" }, 400, headers);
      const result = await openStripeLegs(context, sale, reviewer);
      return json(result, 200, headers);
    }

    if (action === "charge-saved-card") {
      const sale = await ensureSale(context, body, reviewer, catalog);
      if (!posPaymentActionAvailable(context.env, action, sale)) return unavailablePaymentResponse(headers);
      if (!sale.paymentLegs?.length) return json({ error: "Add a payment method before charging" }, 400, headers);
      const result = await chargeSavedCardLeg(context, sale, reviewer, {
        paymentMethodId: body.paymentMethodId,
        paymentLegId: body.paymentLegId,
        confirmed: body.confirmed === true,
      });
      return json(result, 200, headers);
    }

    if (action === "record-cash") {
      const sale = await ensureSale(context, body, reviewer, catalog);
      if (!posPaymentActionAvailable(context.env, action, sale)) return unavailablePaymentResponse(headers);
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
      if (!posPaymentActionAvailable(context.env, action, existing)) return unavailablePaymentResponse(headers);
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
      const sale = updatePosSale(existing, { client: body.client, cart: body.cart, paymentLegs: body.paymentLegs, reviewer, catalog });
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
