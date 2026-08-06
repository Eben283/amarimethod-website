// Minimal Stripe REST helpers for Cloudflare Pages (no stripe SDK).
// Callers pass already-flattened Stripe form keys (e.g. "metadata[sale_id]").

const STRIPE_API = "https://api.stripe.com/v1";

function encodeForm(params) {
  return Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export async function stripeRequest(secretKey, method, path, params, { idempotencyKey } = {}) {
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  };
  if (idempotencyKey) init.headers["Idempotency-Key"] = idempotencyKey;
  let url = `${STRIPE_API}${path}`;
  if (method === "GET") {
    const query = encodeForm(params);
    if (query) url += `?${query}`;
  } else if (params) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = encodeForm(params);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    let message = data?.error?.message || `Stripe ${method} ${path} failed (${res.status})`;
    // Stripe echoes key fragments in this error — never surface them to staff UI.
    if (/invalid api key/i.test(message)) {
      message = "Stripe API key is invalid. Update STRIPE_SECRET_KEY in Cloudflare Pages.";
    }
    const err = new Error(message);
    err.status = res.status;
    err.stripe = data.error || null;
    throw err;
  }
  return data;
}

export async function findOrCreateStripeCustomer(secretKey, { email, name, contactId, phone }) {
  // Prefer a proven GHL-linked customer (especially one that already has cards)
  // before creating a duplicate via email.
  if (contactId && !String(contactId).startsWith("draft_")) {
    const proven = await resolveProvenStripeCustomer(secretKey, { contactId });
    if (proven) return proven;
  }

  if (email) {
    const listed = await stripeRequest(secretKey, "GET", "/customers", { email, limit: 5 });
    const existing = (listed.data || []).find((c) => c && !c.deleted);
    if (existing) {
      if (contactId && existing.metadata?.contactId !== contactId) {
        try {
          await stripeRequest(secretKey, "POST", `/customers/${existing.id}`, {
            "metadata[contactId]": contactId,
          });
        } catch {
          // Non-fatal — Checkout can still proceed with the existing customer.
        }
      }
      return existing;
    }
  }
  return stripeRequest(secretKey, "POST", "/customers", {
    name: name || undefined,
    email: email || undefined,
    phone: phone || undefined,
    "metadata[contactId]": contactId || undefined,
    "metadata[id]": contactId || undefined,
  });
}

export async function createPosCheckoutSession(secretKey, {
  amountCents,
  productLabel,
  saleId,
  paymentLegId,
  contactId,
  customerId,
  customerEmail,
  successUrl,
  cancelUrl,
  legMethod,
}) {
  const params = {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: saleId,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": amountCents,
    "line_items[0][price_data][product_data][name]": productLabel,
    "metadata[sale_id]": saleId,
    "metadata[payment_leg_id]": paymentLegId,
    "metadata[contactId]": contactId || "",
    "metadata[leg_method]": legMethod || "",
    "payment_intent_data[metadata][sale_id]": saleId,
    "payment_intent_data[metadata][payment_leg_id]": paymentLegId,
    "payment_intent_data[metadata][contactId]": contactId || "",
    "payment_intent_data[metadata][leg_method]": legMethod || "",
    // Save the card on the Stripe Customer for later staff-confirmed charges.
    "payment_intent_data[setup_future_usage]": "off_session",
  };
  if (customerId) params.customer = customerId;
  else if (customerEmail) params.customer_email = customerEmail;

  return stripeRequest(secretKey, "POST", "/checkout/sessions", params);
}

function safeCardDescriptor(pm) {
  const card = pm?.card || {};
  return {
    id: pm.id,
    brand: String(card.brand || "card"),
    last4: String(card.last4 || ""),
    expMonth: Number.isInteger(card.exp_month) ? card.exp_month : null,
    expYear: Number.isInteger(card.exp_year) ? card.exp_year : null,
  };
}

/** Resolve a Stripe Customer only with evidence tied to this GHL contactId. Never email-only.
 *  Collects all proven candidates and prefers one that already has a reusable card.
 */
export async function resolveProvenStripeCustomer(secretKey, { contactId, storedCustomerId } = {}) {
  if (!contactId || String(contactId).startsWith("draft_")) return null;

  const belongsToContact = (customer) => {
    if (!customer || customer.deleted) return false;
    const meta = customer.metadata || {};
    // GHL commonly stamps the contact as metadata.id; we also use metadata.contactId.
    if (meta.contactId && meta.contactId !== contactId) return false;
    if (meta.id && meta.id !== contactId) return false;
    return true;
  };

  const loadCustomer = async (customerId) => {
    if (!customerId) return null;
    try {
      const customer = await stripeRequest(secretKey, "GET", `/customers/${customerId}`);
      return belongsToContact(customer) ? customer : null;
    } catch {
      return null;
    }
  };

  const candidates = new Map(); // customerId -> customer
  const add = (customer) => {
    if (customer?.id) candidates.set(customer.id, customer);
  };

  if (storedCustomerId) {
    const stored = await loadCustomer(storedCustomerId);
    if (stored) {
      const meta = stored.metadata || {};
      if (meta.contactId === contactId || meta.id === contactId || (!meta.contactId && !meta.id)) {
        add(stored);
      }
    }
  }

  for (const field of ["contactId", "id"]) {
    try {
      const found = await stripeRequest(secretKey, "GET", "/customers/search", {
        query: `metadata["${field}"]:"${contactId}"`,
        limit: 10,
      });
      for (const row of found.data || []) {
        if (row && !row.deleted && row.metadata?.[field] === contactId && belongsToContact(row)) {
          add(row);
        }
      }
    } catch {
      // Search may be unavailable — continue.
    }
  }

  try {
    const charges = await stripeRequest(secretKey, "GET", "/charges/search", {
      query: `metadata["contactId"]:"${contactId}"`,
      limit: 20,
    });
    for (const charge of charges.data || []) {
      if (!charge?.customer) continue;
      if (charge.metadata?.contactId && charge.metadata.contactId !== contactId) continue;
      add(await loadCustomer(charge.customer));
    }
  } catch {
    // Charge Search unavailable — continue with whatever candidates we have.
  }

  if (!candidates.size) return null;

  let best = null;
  let bestCards = -1;
  for (const customer of candidates.values()) {
    let cardCount = 0;
    try {
      const cards = await listCustomerCards(secretKey, customer.id);
      cardCount = cards.length;
    } catch {
      cardCount = 0;
    }
    // Prefer any customer with cards; otherwise keep first proven match.
    if (cardCount > bestCards) {
      best = customer;
      bestCards = cardCount;
    }
  }

  if (!best) return null;

  // Best-effort: stamp contactId for faster future POS lookups. Never block on this.
  if (best.metadata?.contactId !== contactId) {
    try {
      best = await stripeRequest(secretKey, "POST", `/customers/${best.id}`, {
        "metadata[contactId]": contactId,
      });
    } catch {
      // keep unstamped customer
    }
  }
  return best;
}

export async function listCustomerCards(secretKey, customerId) {
  if (!customerId) return [];
  const listed = await stripeRequest(secretKey, "GET", "/payment_methods", {
    customer: customerId,
    type: "card",
    limit: 20,
  });
  const cards = (listed.data || [])
    .filter((pm) => pm && pm.id && pm.card?.last4)
    .map(safeCardDescriptor);

  // Include invoice default if Stripe has one that wasn't in the type=card page.
  try {
    const customer = await stripeRequest(secretKey, "GET", `/customers/${customerId}`);
    const defaultId = customer?.invoice_settings?.default_payment_method;
    if (typeof defaultId === "string" && defaultId.startsWith("pm_") && !cards.some((c) => c.id === defaultId)) {
      const pm = await stripeRequest(secretKey, "GET", `/payment_methods/${defaultId}`);
      if (pm?.type === "card" && pm.card?.last4 && (!pm.customer || pm.customer === customerId)) {
        cards.unshift(safeCardDescriptor(pm));
      }
    }
  } catch {
    // ignore
  }

  return cards;
}

export async function retrievePaymentMethod(secretKey, paymentMethodId) {
  return stripeRequest(secretKey, "GET", `/payment_methods/${paymentMethodId}`);
}

/**
 * Off-session charge against an attached card. Returns the PaymentIntent.
 * Caller must verify the PaymentMethod belongs to the proven customer first.
 */
export async function chargeCustomerCard(secretKey, {
  amountCents,
  customerId,
  paymentMethodId,
  saleId,
  paymentLegId,
  contactId,
  description,
}) {
  return stripeRequest(secretKey, "POST", "/payment_intents", {
    amount: amountCents,
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    off_session: "true",
    confirm: "true",
    description: description || undefined,
    "metadata[sale_id]": saleId,
    "metadata[payment_leg_id]": paymentLegId,
    "metadata[contactId]": contactId || "",
    "metadata[leg_method]": "saved-card",
  }, {
    // A staff retry after a timeout must resolve to the same Stripe operation,
    // never a second charge for the same immutable payment leg.
    idempotencyKey: `staff-pos:${saleId}:${paymentLegId}:saved-card`,
  });
}

function parseStripeSignatureHeader(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header || "").split(",")) {
    const [k, v] = part.trim().split("=");
    if (k === "t") out.t = v;
    if (k === "v1" && v) out.v1.push(v);
  }
  return out;
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret, toleranceSec = 300) {
  if (!webhookSecret) throw new Error("STRIPE_POS_WEBHOOK_SECRET is not configured");
  const { t, v1 } = parseStripeSignatureHeader(signatureHeader);
  if (!t || !v1.length) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(Number(t)) || age > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((sig) => timingSafeEqualHex(hex, sig));
}
