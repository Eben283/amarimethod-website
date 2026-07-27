// Cloudflare Pages Function: GET/POST /api/staff-pos-sales
// Inactive staff POS drafts. No handler in this file can send a message, create
// a Stripe object, create a GHL order, or affect a session balance.

import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import { buildInactiveTextPreview, buildPosSale, readPosSale, updatePosSale, writePosSale } from "../lib/staff-pos.js";

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function saleId() {
  return `pos_${crypto.randomUUID()}`;
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

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  const { body, error: bodyError } = await parseJsonBody(context.request, headers);
  if (bodyError) return bodyError;
  const action = typeof body.action === "string" ? body.action : "";
  const reviewer = typeof payload?.user === "string" ? payload.user : "Staff";

  try {
    if (action === "create") {
      const sale = buildPosSale({ id: saleId(), client: body.client, cart: body.cart, paymentLegs: body.paymentLegs, reviewer });
      await writePosSale(context.env.PORTAL_KV, sale);
      return json({ sale }, 201, headers);
    }
    const id = typeof body.id === "string" ? body.id : "";
    const existing = await readPosSale(context.env.PORTAL_KV, id);
    if (!existing) return json({ error: "Saved cart not found" }, 404, headers);
    if (action === "save") {
      if (body.version !== undefined && body.version !== existing.version) return json({ error: "This cart changed elsewhere. Reload it before saving." }, 409, headers);
      const sale = updatePosSale(existing, { client: body.client, cart: body.cart, paymentLegs: body.paymentLegs, reviewer });
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
    return json({ error: error instanceof Error ? error.message : "Could not save cart" }, 422, headers);
  }
}
