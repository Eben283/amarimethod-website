// Stripe-hosted checkout support for the staff app.
//
// This module deliberately owns only the payment boundary: it creates a
// Checkout Session and maintains the exact GHL-contact -> Stripe-customer
// association. Fulfillment remains a separate, webhook-driven concern; a
// checkout URL must never itself change a balance or grant access.

const STRIPE_BASE = "https://api.stripe.com/v1";
const CUSTOMER_KEY_PREFIX = "stripe-customer:";

// This is the same current offer set already shown by the staff app's GHL
// payment-link sheet. Prices and GHL product ids are server-side only; a
// browser may select an offer key but never supplies an amount or product id.
export const STAFF_CHECKOUT_OFFERS = Object.freeze({
  "initial-in-person": {
    name: "Initial Session — In Person",
    amountCents: 22500,
    ghlProductId: "688a1cd770362828afbf08a2",
  },
  "initial-virtual": {
    name: "Initial Session — Virtual",
    amountCents: 22500,
    ghlProductId: "690b6b4d333ffa59d40c1823",
  },
  "4-session-series": {
    name: "4-Session Series",
    amountCents: 72000,
    ghlProductId: "69986faa724ecd2343ebaa6e",
  },
  "8-session-series": {
    name: "8-Session Series",
    amountCents: 129500,
    ghlProductId: "69987357c839790426996114",
  },
  "upgrade-initial-to-4": {
    name: "Upgrade: Initial → 4-Session",
    amountCents: 49500,
    ghlProductId: "6998739230cc6054f9bba62d",
  },
  "upgrade-initial-to-8": {
    name: "Upgrade: Initial → 8-Session",
    amountCents: 107000,
    ghlProductId: "699873d6990b71ebc1fa26b4",
  },
  "upgrade-4-to-8": {
    name: "Upgrade: 4-Session → 8-Session",
    amountCents: 57500,
    ghlProductId: "6a010952e41b442c862d3c01",
  },
  "living-practice": {
    name: "Living Practice",
    amountCents: 34700,
    ghlProductId: "6998d7f2606fa79c54fa3ff5",
  },
  "follow-up": {
    name: "Single Follow-up Session",
    amountCents: 19000,
    ghlProductId: "6998ace59dfde469ecb2aab6",
  },
});

export function staffCheckoutOffer(offerKey) {
  return typeof offerKey === "string" ? STAFF_CHECKOUT_OFFERS[offerKey] || null : null;
}

function stripeHeaders(secretKey, extra = {}) {
  return { Authorization: `Bearer ${secretKey}`, ...extra };
}

async function stripeJson(fetchImpl, secretKey, path, init = {}) {
  const response = await fetchImpl(`${STRIPE_BASE}${path}`, {
    ...init,
    headers: stripeHeaders(secretKey, init.headers),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Stripe ${init.method || "GET"} ${path} failed (${response.status}): ${payload?.error?.message || "unknown error"}`);
  }
  return payload;
}

function formPost(fetchImpl, secretKey, path, form, idempotencyKey = null) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return stripeJson(fetchImpl, secretKey, path, {
    method: "POST",
    headers,
    body: form.toString(),
  });
}

function customerCacheKey(contactId) {
  return `${CUSTOMER_KEY_PREFIX}${contactId}`;
}

async function cachedCustomerId(kv, contactId) {
  if (!kv) return null;
  try {
    const stored = await kv.get(customerCacheKey(contactId));
    return typeof stored === "string" && stored.startsWith("cus_") ? stored : null;
  } catch {
    return null;
  }
}

async function cacheCustomerId(kv, contactId, customerId) {
  if (!kv || !customerId) return;
  // This is an internal identity map, not a payment record. It is safe to keep
  // until intentionally replaced, and avoids a dangerous email-based match.
  await kv.put(customerCacheKey(contactId), customerId).catch(() => {});
}

async function customerFromContactStampedCharge(fetchImpl, secretKey, contactId) {
  const query = `metadata[\"contactId\"]:\"${contactId}\"`;
  const payload = await stripeJson(
    fetchImpl,
    secretKey,
    `/charges/search?query=${encodeURIComponent(query)}&limit=10`,
  );
  const match = (payload.data || []).find((charge) => typeof charge.customer === "string" && charge.customer.startsWith("cus_"));
  return match?.customer || null;
}

export async function findExistingStripeCustomer({ fetchImpl = fetch, secretKey, contactId, kv }) {
  const cached = await cachedCustomerId(kv, contactId);
  if (cached) return cached;
  const fromCharge = await customerFromContactStampedCharge(fetchImpl, secretKey, contactId);
  if (fromCharge) await cacheCustomerId(kv, contactId, fromCharge);
  return fromCharge;
}

async function createCustomer({ fetchImpl, secretKey, contact, contactId, kv }) {
  const form = new URLSearchParams();
  form.set("name", [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || "Amari client");
  form.set("email", contact.email);
  form.set("metadata[contactId]", contactId);
  form.set("metadata[source]", "amari_staff_checkout");
  const customer = await formPost(fetchImpl, secretKey, "/customers", form, `amari-customer:${contactId}`);
  if (!customer?.id?.startsWith("cus_")) throw new Error("Stripe created a customer without an id");
  await cacheCustomerId(kv, contactId, customer.id);
  return customer.id;
}

export async function resolveStripeCustomer({ fetchImpl = fetch, secretKey, contactId, contact, kv }) {
  const existing = await findExistingStripeCustomer({ fetchImpl, secretKey, contactId, kv });
  if (existing) return existing;
  return createCustomer({ fetchImpl, secretKey, contact, contactId, kv });
}

export function checkoutForm({ customerId, contactId, offerKey, successUrl, cancelUrl, now = Date.now() }) {
  const offer = staffCheckoutOffer(offerKey);
  if (!offer) throw new Error("Unknown staff checkout offer");
  if (!customerId?.startsWith("cus_")) throw new Error("A Stripe Customer is required");

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("customer", customerId);
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("expires_at", String(Math.floor(now / 1000) + 60 * 60));
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(offer.amountCents));
  form.set("line_items[0][price_data][product_data][name]", offer.name);

  // Checkout uses the payment methods enabled on the Stripe account. That keeps
  // Affirm available where Stripe determines it is eligible, without forcing a
  // payment method that may not be available for a specific client or purchase.
  // A card payment is explicitly saved to this Customer for a future,
  // authorized off-session charge; Checkout presents Stripe's required notice.
  form.set("payment_intent_data[setup_future_usage]", "off_session");
  form.set("payment_method_data[allow_redisplay]", "always");

  const metadata = {
    contactId,
    ghlProductId: offer.ghlProductId,
    offerKey,
    source: "amari_staff_checkout",
  };
  for (const [key, value] of Object.entries(metadata)) {
    form.set(`metadata[${key}]`, value);
    form.set(`payment_intent_data[metadata][${key}]`, value);
  }
  return form;
}

export async function createStaffCheckoutSession({
  fetchImpl = fetch,
  secretKey,
  contactId,
  contact,
  offerKey,
  kv,
  successUrl,
  cancelUrl,
  now,
}) {
  if (!contact?.email) throw new Error("The client needs an email address before checkout can be created");
  const customerId = await resolveStripeCustomer({ fetchImpl, secretKey, contactId, contact, kv });
  const form = checkoutForm({ customerId, contactId, offerKey, successUrl, cancelUrl, now });
  const session = await formPost(
    fetchImpl,
    secretKey,
    "/checkout/sessions",
    form,
    `amari-staff-checkout:${contactId}:${offerKey}:${Math.floor((now || Date.now()) / 60000)}`,
  );
  if (!session?.id || !session?.url) throw new Error("Stripe created a Checkout Session without a URL");
  return { id: session.id, url: session.url, expiresAt: session.expires_at || null, customerId };
}

export async function listSavedCards({ fetchImpl = fetch, secretKey, contactId, kv }) {
  const customerId = await findExistingStripeCustomer({ fetchImpl, secretKey, contactId, kv });
  if (!customerId) return { customerId: null, cards: [] };
  const payload = await stripeJson(
    fetchImpl,
    secretKey,
    `/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=10`,
  );
  const cards = (payload.data || []).flatMap((method) => {
    const card = method?.card;
    if (!card?.brand || !card?.last4) return [];
    return [{ brand: card.brand, last4: card.last4, expMonth: card.exp_month || null, expYear: card.exp_year || null }];
  });
  return { customerId, cards };
}
