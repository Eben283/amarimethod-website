// Cloudflare Pages Function: POST /api/staff-send-paylink
// Sends a GHL payment link to a contact via SMS. Used by Garrett during
// disco-call closes and upgrade conversations.
//
// Server-side product map is the source of truth — never trust a client-provided URL.

import { ghlFetch, applyTagDelta } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { singleSessionOfferFor } from "../lib/session-pricing.js";

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
  "amari-assessment": {
    name: "Amari Assessment",
    price: "$29",
    path: "/payment-link/6a66cf107b99151a540409b3",
  },
  // Placeholder — resolved per contact in onRequestPost via founders-circle tag.
  // Default label is the raised $285; Founder's Circle still receive $190.
  "follow-up": {
    name: "Single Session",
    price: "$285",
    path: "/payment-link/6a6b8bdda655fa0b802a7164",
  },
};


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

  // Hoisted so the outer catch can release an unconsumed dedupe claim — a
  // thrown ghlFetch (the 15s-timeout class the dedupe targets) otherwise left
  // the key claimed, and the staff retry got a false "already sent".
  let claimedDedupeKey = null;
  let claimedDedupeKv = null;
  let smsSent = false;

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const { body, error: parseError } = await parseJsonBody(context.request, headers);



    if (parseError) return parseError;
    const { contactId, product: productKey } = body;

    if (!contactId) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }

    if (!productKey || !PRODUCTS[productKey]) {
      return new Response(JSON.stringify({ error: "Unknown product" }), { status: 400, headers });
    }

    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    if (!contact.phone) {
      return new Response(JSON.stringify({ error: "Contact has no phone number" }), { status: 400, headers });
    }

    let product = PRODUCTS[productKey];
    if (productKey === "follow-up") {
      const offer = singleSessionOfferFor({ tags: contact.tags || [] });
      product = { name: offer.name, price: offer.priceLabel, path: offer.paymentLinkPath };
    }

    // Short-window dedupe: the SPA's 15s fetch timeout + the retry button can
    // re-send while the first POST is still completing server-side — the
    // client then gets the same payment link twice. Claim the key BEFORE
    // sending (released on failure) so the retry hits the marker.
    const dedupeKey = `paylink-sent:${contactId}:${productKey}`;
    const dedupeKv = context.env.PURCHASE_KV || null;
    if (dedupeKv) {
      const recent = await dedupeKv.get(dedupeKey).catch(() => null);
      if (recent) {
        return new Response(JSON.stringify({
          success: true,
          deduped: true,
          message: "This link was already sent moments ago — not re-sending.",
        }), { status: 200, headers });
      }
      await dedupeKv.put(dedupeKey, new Date().toISOString(), { expirationTtl: 120 }).catch(() => {});
      claimedDedupeKey = dedupeKey;
      claimedDedupeKv = dedupeKv;
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
      // Release the dedupe claim so a legitimate retry isn't blocked for 2min.
      if (dedupeKv) await dedupeKv.delete(dedupeKey).catch(() => {});
      return new Response(JSON.stringify({ error: "Failed to send SMS" }), { status: 422, headers });
    }
    smsSent = true;

    // Best-effort: tag the contact for outcome tracking. Don't block on failure.
    // Use the dedicated tag endpoint (additive) rather than a full-array PUT so
    // concurrent contact writes don't clobber each other's tags.
    try {
      const existingTags = contact.tags || [];
      const sentTag = `paylink-sent-${productKey}`;
      if (!existingTags.includes(sentTag)) {
        await applyTagDelta(context, contactId, { add: [sentTag] });
      }
    } catch (err) {
      console.error(`[staff-send-paylink] Tag update failed: ${err.message}`);
    }

    return new Response(JSON.stringify({ success: true, product: productKey }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-send-paylink] Error:", err.message);
    if (claimedDedupeKey && claimedDedupeKv && !smsSent) {
      await claimedDedupeKv.delete(claimedDedupeKey).catch(() => {});
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
