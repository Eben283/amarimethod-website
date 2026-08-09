// Staff POS domain model. Owns cart/sale persistence, server-side prices, and
// payment-leg state. Stripe Checkout Sessions are created by staff-pos-sales;
// signed webhooks mark legs paid. GHL fulfillment is separate and gated.

const MAX_CART_LINES = 24;
const MAX_AMOUNT_CENTS = 2_000_000;
const MAX_CUSTOM_LABEL = 120;
const MAX_LEGS = 6;

export const POS_CATALOG = Object.freeze({
  "amari-assessment": { label: "Amari Assessment ($29)", amountCents: 2900, ghlProductId: "6a66cf0103821ea09ea13f1b" },
  "4-session-series": { label: "4-Session Series", amountCents: 72000, ghlProductId: "69986faa724ecd2343ebaa6e" },
  "8-session-series": { label: "8-Session Series", amountCents: 129500, ghlProductId: "69987357c839790426996114" },
  "12-week-practice": { label: "The 12-Week Amari Practice ($5,400)", amountCents: 540000, ghlProductId: "6a66cde7ef7b07f122ad46fb" },
  "6-week-practice": { label: "The 6-Week Amari Practice ($3,000)", amountCents: 300000, ghlProductId: "6a683360017263178d05d1a3" },
  "upgrade-4-to-8": { label: "Upgrade: 4-Session → 8-Session", amountCents: 57500, ghlProductId: "6a010952e41b442c862d3c01" },
  "entrainment": { label: "Entrainment", amountCents: 9000, ghlProductId: "69c5d29c4019ce8e80e2513b" },
  "entrainment-20": { label: "Entrainment — 20 Minutes", amountCents: 9000, ghlProductId: "6a734f0cecc97342c37bdbbb" },
  "living-practice": { label: "Living Practice", amountCents: 34700, ghlProductId: "6998d7f2606fa79c54fa3ff5" },
  "follow-up": { label: "Single Follow-up Session", amountCents: 19000, ghlProductId: "6998ace59dfde469ecb2aab6" },
  "single-session": { label: "Single Session (50 min)", amountCents: 28500, ghlProductId: "6a6b8bb7a1753b65945372f1" },
});

export const POS_PAYMENT_METHODS = Object.freeze(["saved-card", "manual-card", "hsa-card", "checkout-link", "cash", "other"]);
export const STRIPE_CHECKOUT_METHODS = Object.freeze(["manual-card", "hsa-card", "checkout-link"]);
export const POS_SALE_STATUSES = Object.freeze(["draft", "awaiting_payment", "partially_paid", "paid"]);
export const POS_LEG_STATUSES = Object.freeze(["planned", "checkout_open", "paid", "failed"]);

export function isStripeCheckoutMethod(method) {
  return STRIPE_CHECKOUT_METHODS.includes(method);
}

export function isSavedCardMethod(method) {
  return method === "saved-card";
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validCents(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT_CENTS;
}

function knownFields(value, allowed, subject = "cart") {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) throw new Error(`Unknown ${subject} field: ${key}`);
  }
}

export function normalizeCart(rawCart, catalog = POS_CATALOG) {
  if (!Array.isArray(rawCart) || rawCart.length < 1 || rawCart.length > MAX_CART_LINES) {
    throw new Error("A sale needs between 1 and 24 cart lines");
  }
  return rawCart.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid cart line");
    knownFields(raw, new Set(["productKey", "quantity", "customLabel", "customAmountCents", "customReason"]));
    const quantity = raw.quantity === undefined ? 1 : raw.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("Cart quantity must be between 1 and 20");
    if (typeof raw.productKey === "string") {
      const product = catalog[raw.productKey];
      if (!product) throw new Error("Unknown catalog product");
      return Object.freeze({
        kind: "catalog",
        productKey: raw.productKey,
        productVersion: Number.isInteger(product.productVersion) ? product.productVersion : 1,
        label: product.label,
        ghlProductId: product.ghlProductId,
        fulfillmentPolicy: product.fulfillmentPolicy || "provider-linked",
        quantity,
        unitAmountCents: product.amountCents,
        lineTotalCents: product.amountCents * quantity,
      });
    }
    const label = cleanText(raw.customLabel, MAX_CUSTOM_LABEL);
    if (!label) throw new Error("Custom item needs a label");
    const reason = cleanText(raw.customReason, MAX_CUSTOM_LABEL);
    if (!reason) throw new Error("Custom item needs a category or reason");
    if (!validCents(raw.customAmountCents)) throw new Error("Custom amount must be a whole number of cents");
    return Object.freeze({
      kind: "custom",
      productKey: null,
      productVersion: null,
      label,
      reason,
      ghlProductId: null,
      fulfillmentPolicy: "none",
      quantity,
      unitAmountCents: raw.customAmountCents,
      lineTotalCents: raw.customAmountCents * quantity,
    });
  });
}

export function cartTotal(cart) {
  const total = cart.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_AMOUNT_CENTS) throw new Error("Cart total is outside the allowed range");
  return total;
}

export function normalizeClient(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A client is required");
  const id = cleanText(raw.id, 100);
  const name = cleanText(raw.name, 160);
  const phone = cleanText(raw.phone, 40);
  const email = cleanText(raw.email, 160).toLowerCase();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error("Invalid client");
  if (!name) throw new Error("Client name is required");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Client email is invalid");
  if (!phone && !email) throw new Error("Add a phone number or email address");
  return Object.freeze({ id, name, phone: phone || null, email: email || null });
}

export function normalizePaymentLegs(rawLegs, totalCents) {
  if (!Array.isArray(rawLegs)) throw new Error("Payment allocations are required");
  if (rawLegs.length > MAX_LEGS) throw new Error("A sale can have at most 6 payment allocations");
  const legs = rawLegs.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid payment allocation");
    knownFields(raw, new Set(["method", "amountCents"]), "payment allocation");
    const method = cleanText(raw.method, 40);
    if (!POS_PAYMENT_METHODS.includes(method)) throw new Error("Unknown payment method");
    if (!validCents(raw.amountCents)) throw new Error("Payment allocation must be a whole number of cents");
    return Object.freeze({
      id: `leg-${index + 1}`,
      method,
      amountCents: raw.amountCents,
      status: "planned",
      stripeCheckoutSessionId: null,
      stripeCheckoutUrl: null,
      stripePaymentIntentId: null,
      cashReceivedCents: null,
      paidAt: null,
    });
  });
  if (legs.length && legs.reduce((sum, leg) => sum + leg.amountCents, 0) !== totalCents) {
    throw new Error("Payment allocations must equal the sale total");
  }
  return legs;
}

export function salePaidCents(sale) {
  return (sale?.paymentLegs || [])
    .filter((leg) => leg.status === "paid")
    .reduce((sum, leg) => sum + (leg.amountCents || 0), 0);
}

export function recomputeSaleStatus(sale) {
  const legs = sale?.paymentLegs || [];
  if (!legs.length) return "draft";
  const paidCount = legs.filter((leg) => leg.status === "paid").length;
  if (paidCount === legs.length) return "paid";
  if (paidCount > 0) return "partially_paid";
  if (legs.some((leg) => leg.status === "checkout_open")) return "awaiting_payment";
  return sale.status === "draft" ? "draft" : "awaiting_payment";
}

export function attachCheckoutSession(sale, paymentLegId, session, reviewer, now) {
  const at = now || new Date().toISOString();
  const actor = cleanText(reviewer, 80) || "Staff";
  let found = false;
  const paymentLegs = (sale.paymentLegs || []).map((leg) => {
    if (leg.id !== paymentLegId) return leg;
    found = true;
    if (leg.status === "paid") return leg;
    return {
      ...leg,
      status: "checkout_open",
      stripeCheckoutSessionId: session.id,
      stripeCheckoutUrl: session.url,
    };
  });
  if (!found) throw new Error("Payment leg not found");
  const next = {
    ...sale,
    paymentLegs,
    updatedAt: at,
    status: "awaiting_payment",
    audit: [
      ...(sale.audit || []),
      {
        at,
        actor,
        action: "checkout_session_created",
        detail: `Stripe Checkout opened for ${paymentLegId} (${session.id}).`,
      },
    ],
  };
  next.status = recomputeSaleStatus(next);
  return next;
}

export function markLegPaid(sale, paymentLegId, { paymentIntentId, cashReceivedCents, reviewer, now, source } = {}) {
  const at = now || new Date().toISOString();
  const actor = cleanText(reviewer, 80) || source || "Stripe";
  let found = false;
  const paymentLegs = (sale.paymentLegs || []).map((leg) => {
    if (leg.id !== paymentLegId) return leg;
    found = true;
    if (leg.status === "paid") return leg;
    return {
      ...leg,
      status: "paid",
      paidAt: at,
      stripePaymentIntentId: paymentIntentId || leg.stripePaymentIntentId || null,
      cashReceivedCents: cashReceivedCents ?? leg.cashReceivedCents,
    };
  });
  if (!found) throw new Error("Payment leg not found");
  const next = {
    ...sale,
    paymentLegs,
    updatedAt: at,
    version: (Number.isInteger(sale.version) ? sale.version : 0) + 1,
    audit: [
      ...(sale.audit || []),
      {
        at,
        actor,
        action: "payment_leg_paid",
        detail: `Payment leg ${paymentLegId} marked paid via ${source || "webhook"}.`,
      },
    ],
  };
  next.status = recomputeSaleStatus(next);
  if (next.status === "paid" && !next.fulfillmentStatus) {
    next.fulfillmentStatus = "pending";
    next.audit.push({
      at,
      actor,
      action: "sale_paid",
      detail: "All payment legs settled. GHL fulfillment is pending.",
    });
  }
  return next;
}

export function cartSummaryLabel(sale) {
  const lines = sale?.cart || [];
  if (!lines.length) return "Amari Method purchase";
  if (lines.length === 1) return lines[0].label;
  return `${lines[0].label} + ${lines.length - 1} more`;
}

export function posSessionKey(sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId || "")) throw new Error("Invalid Checkout Session id");
  return `staff-pos:session:${sessionId}`;
}

export function posSaleKey(id) {
  if (!/^pos_[a-z0-9-]{8,80}$/i.test(id || "")) throw new Error("Invalid POS sale id");
  return `staff-pos:sale:${id}`;
}

export function buildPosSale({ id, client, cart, paymentLegs, reviewer, now, catalog }) {
  const normalizedClient = normalizeClient(client);
  const normalizedCart = normalizeCart(cart, catalog);
  const totalCents = cartTotal(normalizedCart);
  const normalizedLegs = normalizePaymentLegs(paymentLegs || [], totalCents);
  const at = now || new Date().toISOString();
  const reviewerName = cleanText(reviewer, 80) || "Staff";
  return {
    id,
    status: "draft",
    version: 1,
    client: normalizedClient,
    cart: normalizedCart,
    totalCents,
    paymentLegs: normalizedLegs,
    createdAt: at,
    updatedAt: at,
    createdBy: reviewerName,
    audit: [{ at, actor: reviewerName, action: "draft_created", detail: "Draft cart created. No payment, text, or GHL change was made." }],
  };
}

export function updatePosSale(existing, { client, cart, paymentLegs, reviewer, now, catalog }) {
  if (!existing?.id) throw new Error("Sale not found");
  if (existing.status === "paid") throw new Error("This sale is already paid and cannot be edited");
  if ((existing.paymentLegs || []).some((leg) => leg.status === "paid")) {
    throw new Error("This sale cannot be edited after a payment has been recorded");
  }
  const next = buildPosSale({ id: existing.id, client, cart, paymentLegs, reviewer, now, catalog });
  const at = next.updatedAt;
  // Preserve Stripe/cash settlement fields when the staff client re-saves allocations.
  const priorByKey = new Map(
    (existing.paymentLegs || []).map((leg) => [`${leg.method}:${leg.amountCents}:${leg.id}`, leg]),
  );
  const priorByMethodAmount = new Map(
    (existing.paymentLegs || []).map((leg) => [`${leg.method}:${leg.amountCents}`, leg]),
  );
  const mergedLegs = next.paymentLegs.map((leg, index) => {
    const prior =
      priorByKey.get(`${leg.method}:${leg.amountCents}:${leg.id}`) ||
      priorByMethodAmount.get(`${leg.method}:${leg.amountCents}`) ||
      existing.paymentLegs?.[index];
    if (!prior) return leg;
    return {
      ...leg,
      id: prior.id || leg.id,
      status: prior.status === "paid" || prior.status === "checkout_open" ? prior.status : leg.status,
      stripeCheckoutSessionId: prior.stripeCheckoutSessionId || null,
      stripeCheckoutUrl: prior.stripeCheckoutUrl || null,
      stripePaymentIntentId: prior.stripePaymentIntentId || null,
      cashReceivedCents: prior.cashReceivedCents,
      paidAt: prior.paidAt || null,
    };
  });
  const merged = {
    ...next,
    paymentLegs: mergedLegs,
    status: existing.status === "draft" ? "draft" : existing.status,
    version: (Number.isInteger(existing.version) ? existing.version : 0) + 1,
    createdAt: existing.createdAt || at,
    createdBy: existing.createdBy || next.createdBy,
    fulfillmentStatus: existing.fulfillmentStatus || null,
    audit: [...(Array.isArray(existing.audit) ? existing.audit : []), { at, actor: next.createdBy, action: "draft_saved", detail: "Draft cart or payment plan updated." }],
  };
  merged.status = recomputeSaleStatus(merged);
  return merged;
}

export function buildInactiveTextPreview(sale, reviewer, now) {
  const linkLeg = sale?.paymentLegs?.find((leg) => leg.method === "checkout-link");
  if (!linkLeg) throw new Error("Add a checkout-link payment allocation before preparing a checkout text");
  if (!sale.client?.phone) throw new Error("The selected client needs a phone number before a checkout text can be prepared");
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(linkLeg.amountCents / 100);
  const at = now || new Date().toISOString();
  const actor = cleanText(reviewer, 80) || "Staff";
  const message = `Amari Method: your secure checkout for ${amount} will be sent here once staff POS is activated.`;
  return {
    sale: {
      ...sale,
      updatedAt: at,
      audit: [...(sale.audit || []), { at, actor, action: "checkout_text_previewed", detail: "Checkout text previewed. Sending is disabled; no text was sent." }],
    },
    preview: { recipient: sale.client.phone, amountCents: linkLeg.amountCents, message, sendingEnabled: false },
  };
}

export async function readPosSale(kv, id) {
  if (!kv) throw new Error("POS storage is not configured");
  return kv.get(posSaleKey(id), "json");
}

export async function writePosSale(kv, sale) {
  if (!kv) throw new Error("POS storage is not configured");
  await kv.put(posSaleKey(sale.id), JSON.stringify(sale));
  return sale;
}
