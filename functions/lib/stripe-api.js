// Minimal Stripe REST helpers for Cloudflare Pages (no stripe SDK).
// Callers pass already-flattened Stripe form keys (e.g. "metadata[sale_id]").

const STRIPE_API = "https://api.stripe.com/v1";

function encodeForm(params) {
  return Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export async function stripeRequest(secretKey, method, path, params) {
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  };
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
  };
  if (customerId) params.customer = customerId;
  else if (customerEmail) params.customer_email = customerEmail;

  return stripeRequest(secretKey, "POST", "/checkout/sessions", params);
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
