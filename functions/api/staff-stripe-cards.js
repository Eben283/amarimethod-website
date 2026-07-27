// Cloudflare Pages Function: GET /api/staff-stripe-cards?contactId=
// Returns only display-safe card metadata (brand, last four, expiry) for a
// staff-authenticated client view. It never exposes a Stripe PaymentMethod id.

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";
import { listSavedCards } from "../lib/staff-stripe-checkout.js";

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, OPTIONS") });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error: authError } = await requireStaffAuth(context, headers);
  if (authError) return authError;
  if (context.env.STRIPE_STAFF_CHECKOUT_ENABLED !== "true" || !context.env.STRIPE_STAFF_CHECKOUT_SECRET_KEY) {
    return new Response(JSON.stringify({ available: false, cards: [] }), { status: 200, headers });
  }
  const contactId = new URL(context.request.url).searchParams.get("contactId")?.trim() || "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(contactId)) {
    return new Response(JSON.stringify({ error: "Invalid client" }), { status: 400, headers });
  }
  try {
    const result = await listSavedCards({
      secretKey: context.env.STRIPE_STAFF_CHECKOUT_SECRET_KEY,
      contactId,
      kv: context.env.PURCHASE_KV,
    });
    return new Response(JSON.stringify({ available: true, cards: result.cards }), { status: 200, headers });
  } catch (error) {
    console.error("[staff-stripe-cards]", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: "Could not load saved cards" }), { status: 422, headers });
  }
}
