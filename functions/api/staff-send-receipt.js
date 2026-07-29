// POST /api/staff-send-receipt
// Finds the contact's latest Stripe charge with a receipt_url and texts/emails
// the link. Operator recovery for "can't see my PDF receipt" cases.

import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { ghlFetch } from "../lib/ghl.js";
import { resolveContactCharges, makeStripeClient } from "../lib/stripe-charges.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const METHODS = "POST, OPTIONS";

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), METHODS),
  });
}

export async function onRequestPost(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), METHODS),
    "Content-Type": "application/json",
  };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const { body, error: parseError } = await parseJsonBody(context.request, headers);
  if (parseError) return parseError;

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const channel = body.channel === "email" ? "email" : "sms";
  if (!contactId) return json({ error: "contactId required" }, 400, headers);

  const stripeKey = context.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ error: "Stripe is not configured" }, 503, headers);

  const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
  if (!contactRes.ok) return json({ error: "Could not load that contact." }, 404, headers);
  const contactData = await contactRes.json();
  const contact = contactData.contact || contactData;
  const email = contact.email || "";
  const phone = contact.phone || "";

  const stripe = makeStripeClient(stripeKey);
  const charges = await resolveContactCharges(stripe, {
    contactId,
    email: email || undefined,
  });
  const withReceipt = (charges || [])
    .filter((c) => c && c.status === "succeeded" && c.receipt_url)
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  const charge = withReceipt[0];
  if (!charge) {
    return json({ error: "No Stripe receipt found for this person yet." }, 404, headers);
  }

  const amount = typeof charge.amount === "number" ? `$${(charge.amount / 100).toFixed(2)}` : "your payment";
  const message = `Here's your Amari Method receipt for ${amount}:\n\n${charge.receipt_url}`;

  if (channel === "email") {
    if (!email) return json({ error: "No email on this contact." }, 400, headers);
    const sendRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "Email",
        contactId,
        subject: "Your Amari Method receipt",
        html: `<p>Here's your Amari Method receipt for ${amount}:</p><p><a href="${charge.receipt_url}">View receipt</a></p>`,
      }),
    });
    if (!sendRes.ok) {
      const detail = await sendRes.text();
      console.error("[staff-send-receipt] email failed", sendRes.status, detail.slice(0, 200));
      return json({ error: "Could not send the receipt email." }, 502, headers);
    }
  } else {
    if (!phone) return json({ error: "No phone on this contact — try email." }, 400, headers);
    const sendRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message,
      }),
    });
    if (!sendRes.ok) {
      const detail = await sendRes.text();
      console.error("[staff-send-receipt] sms failed", sendRes.status, detail.slice(0, 200));
      return json({ error: "Could not send the receipt text." }, 502, headers);
    }
  }

  return json({
    ok: true,
    channel,
    receiptUrl: charge.receipt_url,
    amount: charge.amount,
    chargeId: charge.id,
  }, 200, headers);
}
