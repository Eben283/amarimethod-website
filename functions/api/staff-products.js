import {
  corsHeaders,
  parseJsonBody,
  requireEbenStaffAuth,
  requireStaffAuth,
} from "../lib/endpoint-guards.js";
import { createStaffProduct, listStaffProducts } from "../lib/staff-products.js";

function responseHeaders(context, methods) {
  return {
    ...corsHeaders(context.request.headers.get("Origin") || "", methods),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function json(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers });
}

function publicProduct(product) {
  const { ghlProductId: _providerProductId, ...visible } = product;
  return visible;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context, "GET, POST, OPTIONS") });
}

export async function onRequestGet(context) {
  const headers = responseHeaders(context, "GET, POST, OPTIONS");
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  const result = await listStaffProducts(context.env.ATTEND_DB || null);
  return json({
    ...result,
    products: result.products.map(publicProduct),
    canCreate: result.canCreate && payload?.user === "Eben",
  }, 200, headers);
}

export async function onRequestPost(context) {
  const headers = responseHeaders(context, "GET, POST, OPTIONS");
  const auth = await requireEbenStaffAuth(context, headers);
  if (auth.error) return auth.error;
  const parsed = await parseJsonBody(context.request, headers);
  if (parsed.error) return parsed.error;
  try {
    const product = await createStaffProduct(context.env.ATTEND_DB || null, parsed.body, {
      actor: auth.payload?.user || "Eben",
    });
    return json({ product: publicProduct(product) }, 201, headers);
  } catch (cause) {
    const status = Number(cause?.status) || 500;
    const safeStatus = [400, 409, 503].includes(status) ? status : 500;
    if (safeStatus === 500) console.error("[staff-products] create", cause instanceof Error ? cause.message : cause);
    return json({ error: cause instanceof Error ? cause.message : "Could not create product" }, safeStatus, headers);
  }
}
