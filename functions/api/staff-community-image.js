// GET /api/staff-community-image?partnerId=...&image=0
// Serves one field-visit photo on demand for the authenticated Staff board.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import { listFieldPartners } from "../lib/cos-field-visits.js";

function dataUrl(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const mime = isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };
  try {
    const { error, payload } = await requireStaffAuth(context, headers);
    if (error) return error;

    const url = new URL(context.request.url);
    const partnerId = url.searchParams.get("partnerId") || "";
    const imageIndex = Number(url.searchParams.get("image") || "0");
    if (!/^business_[a-z0-9-]{1,280}$/i.test(partnerId) || !Number.isInteger(imageIndex) || imageIndex < 0) {
      return new Response(JSON.stringify({ error: "Invalid image request" }), { status: 400, headers });
    }

    const users = [...new Set([payload.user, "Eben", "Staff"].filter(Boolean))];
    const lists = await Promise.all(users.map((user) => listFieldPartners(context.env.PORTAL_KV, user, { limit: 500 })));
    const partner = lists.flat().find((entry) => entry.id === partnerId);
    const imageKeys = Array.isArray(partner?.image_keys) ? partner.image_keys : [];
    if (!imageKeys.length) {
      return new Response(JSON.stringify({ image_count: 0, image_data_url: null }), { status: 200, headers });
    }
    if (imageIndex >= imageKeys.length) {
      return new Response(JSON.stringify({ error: "Image not found" }), { status: 404, headers });
    }

    const image = await context.env.PORTAL_KV.get(imageKeys[imageIndex], "arrayBuffer");
    if (!image) {
      return new Response(JSON.stringify({ error: "Image not found" }), { status: 404, headers });
    }
    return new Response(JSON.stringify({ image_count: imageKeys.length, image_data_url: dataUrl(image) }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-community-image]", err);
    return new Response(JSON.stringify({ error: "Could not load the relationship image" }), { status: 500, headers });
  }
}
