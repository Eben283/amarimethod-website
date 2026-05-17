// Cloudflare Pages Function: POST /api/staff-send-paylink
// Sends a GHL payment link to a contact via SMS. Used by Garrett during
// disco-call closes and upgrade conversations.
//
// Server-side product map is the source of truth — never trust a client-provided URL.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
// GHL payment links are hosted on the GHL-managed subdomain, NOT the
// main site. Confirmed via existing usage in portal/src/components/QuickActions.tsx.
const BASE_URL = "https://link.amarimethod.com";

const PRODUCTS = {
  "initial-in-person": {
    name: "Initial Session (in-person)",
    price: "$225",
    path: "/payment-link/6a00f7c1c959774531bed6b6",
  },
  "initial-virtual": {
    name: "Initial Session (virtual)",
    price: "$225",
    path: "/payment-link/6a00f80c1d5a394a682e3fcb",
  },
  "4-session-series": {
    name: "4-Session Series",
    price: "$720",
    path: "/payment-link/69986ff988a3f0163e84003d",
  },
  "8-session-series": {
    name: "8-Session Series",
    price: "$1,295",
    path: "/payment-link/6998736ab409476885754915",
  },
  "upgrade-initial-to-4": {
    name: "Upgrade: Initial → 4-Session",
    price: "$495",
    path: "/payment-link/699873a81a8400115e0381db",
  },
  "upgrade-initial-to-8": {
    name: "Upgrade: Initial → 8-Session",
    price: "$1,070",
    path: "/payment-link/699873e31a840007c0038223",
  },
  "upgrade-4-to-8": {
    name: "Upgrade: 4-Session → 8-Session",
    price: "$575",
    path: "/payment-link/6a010977c959774531bed6c4",
  },
  "living-practice": {
    name: "Living Practice",
    price: "$347",
    path: "/payment-link/6a0107f11d5a394a682e3fd3",
  },
  "follow-up": {
    name: "Follow-up Session",
    price: "$190",
    path: "/payment-link/6998ad0288a3f09db4845d26",
  },
};

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function buildMessage(product) {
  return `Here's your payment link for the ${product.name} (${product.price}):\n\n${BASE_URL}${product.path}`;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
    }

    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const body = await context.request.json();
    const { contactId, product: productKey } = body;

    if (!contactId) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }

    if (!productKey || !PRODUCTS[productKey]) {
      return new Response(JSON.stringify({ error: "Unknown product" }), { status: 400, headers });
    }

    const product = PRODUCTS[productKey];

    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    if (!contact.phone) {
      return new Response(JSON.stringify({ error: "Contact has no phone number" }), { status: 400, headers });
    }

    const smsRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message: buildMessage(product),
      }),
    });

    if (!smsRes.ok) {
      const errText = await smsRes.text();
      console.error(`[staff-send-paylink] SMS send failed: ${smsRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to send SMS" }), { status: 422, headers });
    }

    // Best-effort: tag the contact for outcome tracking. Don't block on failure.
    try {
      const existingTags = contact.tags || [];
      const sentTag = `paylink-sent-${productKey}`;
      if (!existingTags.includes(sentTag)) {
        await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
          method: "PUT",
          body: JSON.stringify({
            tags: [...existingTags, sentTag],
          }),
        });
      }
    } catch (err) {
      console.error(`[staff-send-paylink] Tag update failed: ${err.message}`);
    }

    return new Response(JSON.stringify({ success: true, product: productKey }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-send-paylink] Error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
