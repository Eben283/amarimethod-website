// Inactive staff POS domain model. This owns draft-cart persistence and all
// server-side prices/allocation math. It deliberately creates neither a
// Stripe object nor a GHL order, message, note, or contact update.

const MAX_CART_LINES = 24;
const MAX_AMOUNT_CENTS = 2_000_000;
const MAX_CUSTOM_LABEL = 120;
const MAX_LEGS = 6;

export const POS_CATALOG = Object.freeze({
  "initial-in-person": { label: "Initial Session — In Person", amountCents: 22500, ghlProductId: "688a1cd770362828afbf08a2" },
  "initial-virtual": { label: "Initial Session — Virtual", amountCents: 22500, ghlProductId: "690b6b4d333ffa59d40c1823" },
  "4-session-series": { label: "4-Session Series", amountCents: 72000, ghlProductId: "69986faa724ecd2343ebaa6e" },
  "8-session-series": { label: "8-Session Series", amountCents: 129500, ghlProductId: "69987357c839790426996114" },
  "12-week-practice": { label: "The 12-Week Amari Practice", amountCents: 550000, ghlProductId: "6a66cde7ef7b07f122ad46fb" },
  "upgrade-initial-to-4": { label: "Upgrade: Initial → 4-Session", amountCents: 49500, ghlProductId: "6998739230cc6054f9bba62d" },
  "upgrade-initial-to-8": { label: "Upgrade: Initial → 8-Session", amountCents: 107000, ghlProductId: "699873d6990b71ebc1fa26b4" },
  "upgrade-4-to-8": { label: "Upgrade: 4-Session → 8-Session", amountCents: 57500, ghlProductId: "6a010952e41b442c862d3c01" },
  "entrainment": { label: "Entrainment", amountCents: 9000, ghlProductId: "69c5d29c4019ce8e80e2513b" },
  "living-practice": { label: "Living Practice", amountCents: 34700, ghlProductId: "6998d7f2606fa79c54fa3ff5" },
  "follow-up": { label: "Single Follow-up Session", amountCents: 19000, ghlProductId: "6998ace59dfde469ecb2aab6" },
});

export const POS_PAYMENT_METHODS = Object.freeze(["saved-card", "manual-card", "hsa-card", "checkout-link", "cash", "other"]);

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validCents(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT_CENTS;
}

function knownFields(value, allowed) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) throw new Error(`Unknown cart field: ${key}`);
  }
}

export function normalizeCart(rawCart) {
  if (!Array.isArray(rawCart) || rawCart.length < 1 || rawCart.length > MAX_CART_LINES) {
    throw new Error("A sale needs between 1 and 24 cart lines");
  }
  return rawCart.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid cart line");
    knownFields(raw, new Set(["productKey", "quantity", "customLabel", "customAmountCents", "customReason"]));
    const quantity = raw.quantity === undefined ? 1 : raw.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("Cart quantity must be between 1 and 20");
    if (typeof raw.productKey === "string") {
      const product = POS_CATALOG[raw.productKey];
      if (!product) throw new Error("Unknown catalog product");
      return Object.freeze({
        kind: "catalog",
        productKey: raw.productKey,
        label: product.label,
        ghlProductId: product.ghlProductId,
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
      label,
      reason,
      ghlProductId: null,
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
    const method = cleanText(raw.method, 40);
    if (!POS_PAYMENT_METHODS.includes(method)) throw new Error("Unknown payment method");
    if (!validCents(raw.amountCents)) throw new Error("Payment allocation must be a whole number of cents");
    return Object.freeze({ id: `leg-${index + 1}`, method, amountCents: raw.amountCents, status: "planned" });
  });
  if (legs.length && legs.reduce((sum, leg) => sum + leg.amountCents, 0) !== totalCents) {
    throw new Error("Payment allocations must equal the sale total");
  }
  return legs;
}

export function posSaleKey(id) {
  if (!/^pos_[a-z0-9-]{8,80}$/i.test(id || "")) throw new Error("Invalid POS sale id");
  return `staff-pos:sale:${id}`;
}

export function buildPosSale({ id, client, cart, paymentLegs, reviewer, now }) {
  const normalizedClient = normalizeClient(client);
  const normalizedCart = normalizeCart(cart);
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

export function updatePosSale(existing, { client, cart, paymentLegs, reviewer, now }) {
  if (!existing?.id) throw new Error("Sale not found");
  const next = buildPosSale({ id: existing.id, client, cart, paymentLegs, reviewer, now });
  const at = next.updatedAt;
  return {
    ...next,
    status: existing.status === "draft" ? "draft" : existing.status,
    version: (Number.isInteger(existing.version) ? existing.version : 0) + 1,
    createdAt: existing.createdAt || at,
    createdBy: existing.createdBy || next.createdBy,
    audit: [...(Array.isArray(existing.audit) ? existing.audit : []), { at, actor: next.createdBy, action: "draft_saved", detail: "Draft cart or payment plan updated. No payment, text, or GHL change was made." }],
  };
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
