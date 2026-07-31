// Cloudflare Pages Function: GET /api/staff-stripe-cards?contactId=
// Read-only: brand / last4 / expiry for cards on a proven Stripe Customer.
// Never resolves by email alone (FR-03).

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";
import { listCustomerCards, resolveProvenStripeCustomer } from "../lib/stripe-api.js";
import { writeOpsLastRun, OPS_READY_KEYS } from "../lib/ops-last-run.js";

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
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
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, OPTIONS") });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const contactId = (new URL(context.request.url).searchParams.get("contactId") || "").trim();
  if (!contactId) return json({ error: "contactId required" }, 400, headers);
  if (contactId.startsWith("draft_")) return json({ available: false, reason: "draft_client", cards: [] }, 200, headers);

  const secret = context.env.STRIPE_SECRET_KEY;
  if (!secret) {
    await writeOpsLastRun(context.env, OPS_READY_KEYS.stripe, {
      ok: false,
      checkedAt: new Date().toISOString(),
      error: "STRIPE_SECRET_KEY not configured",
    });
    return json({ available: false, reason: "stripe_not_configured", cards: [] }, 200, headers);
  }

  try {
    const stored = await storedCustomerId(context.env, contactId);
    const customer = await resolveProvenStripeCustomer(secret, { contactId, storedCustomerId: stored });
    // Stripe API answered — readiness ok even when this contact has no customer.
    await writeOpsLastRun(context.env, OPS_READY_KEYS.stripe, {
      ok: true,
      checkedAt: new Date().toISOString(),
    });
    if (!customer) {
      return json({ available: false, reason: "no_proven_customer", cards: [] }, 200, headers);
    }
    if (customer.id !== stored) await rememberCustomer(context.env, contactId, customer.id);

    const cards = await listCustomerCards(secret, customer.id);
    return json({
      available: cards.length > 0,
      reason: cards.length ? null : "no_cards",
      cards,
    }, 200, headers);
  } catch (err) {
    console.error("[staff-stripe-cards]", err instanceof Error ? err.message : err);
    await writeOpsLastRun(context.env, OPS_READY_KEYS.stripe, {
      ok: false,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : "lookup_failed",
    });
    return json({ available: false, reason: "lookup_failed", cards: [] }, 200, headers);
  }
}
