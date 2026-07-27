// Cloudflare Pages Function: POST /api/staff-create-stripe-checkout
//
// Creates a Stripe-hosted Checkout link from the authenticated staff app.
// It is intentionally disabled until the separate restricted Stripe key and
// webhook are configured. Creating a link never fulfills a purchase; only the
// later signed Stripe webhook may do that.

import { ghlFetch } from "../lib/ghl.js";
import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import { createStaffCheckoutSession, staffCheckoutOffer } from "../lib/staff-stripe-checkout.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const COMPLETE_URL = "https://www.amarimethod.com/payment-complete.html";
const CANCEL_URL = "https://www.amarimethod.com/staff/";

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "POST, OPTIONS") });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error: authError } = await requireStaffAuth(context, headers);
  if (authError) return authError;
  const { body, error: bodyError } = await parseJsonBody(context.request, headers);
  if (bodyError) return bodyError;

  // This is the hard deployment gate. The endpoint may be shipped and tested
  // locally, but cannot create a live Checkout Session until an explicit future
  // activation changes this environment flag.
  if (context.env.STRIPE_STAFF_CHECKOUT_ENABLED !== "true" || !context.env.STRIPE_STAFF_CHECKOUT_SECRET_KEY) {
    return new Response(JSON.stringify({ error: "Stripe staff checkout is not activated yet" }), { status: 422, headers });
  }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const offerKey = typeof body.offer === "string" ? body.offer : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(contactId)) {
    return new Response(JSON.stringify({ error: "Invalid client" }), { status: 400, headers });
  }
  if (!staffCheckoutOffer(offerKey)) {
    return new Response(JSON.stringify({ error: "Unknown checkout offer" }), { status: 400, headers });
  }

  try {
    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`);
    if (!contactRes.ok) return new Response(JSON.stringify({ error: "Client not found" }), { status: 404, headers });
    const contact = (await contactRes.json()).contact;
    const checkout = await createStaffCheckoutSession({
      secretKey: context.env.STRIPE_STAFF_CHECKOUT_SECRET_KEY,
      contactId,
      contact,
      offerKey,
      kv: context.env.PURCHASE_KV,
      successUrl: `${COMPLETE_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: CANCEL_URL,
    });
    return new Response(JSON.stringify({ checkout }), { status: 200, headers });
  } catch (error) {
    console.error("[staff-create-stripe-checkout]", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: "Could not create secure checkout" }), { status: 422, headers });
  }
}
