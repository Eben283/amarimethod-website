// Cloudflare Pages Function: POST /api/staff-send-toolkit
// Sends the partner toolkit SMS to an affiliate partner

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

const TOOLKIT_MESSAGE = `Hey! Here's your Amari Method partner toolkit — everything you need to refer clients and track your earnings:\n\nhttps://www.amarimethod.com/partner-app\n\nLog in with your email and you're all set. Reach out anytime if you have questions!`;

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

    // Verify staff auth
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

    // Parse request
    const body = await context.request.json();
    const { contactId } = body;

    if (!contactId) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }

    // Verify contact exists and has affiliate-partner tag
    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;
    const tags = contact.tags || [];

    if (!tags.includes("affiliate-partner")) {
      return new Response(JSON.stringify({ error: "Contact is not an affiliate partner" }), { status: 400, headers });
    }

    if (!contact.phone) {
      return new Response(JSON.stringify({ error: "Contact has no phone number" }), { status: 400, headers });
    }

    // Send SMS via GHL conversations API
    const smsRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message: TOOLKIT_MESSAGE,
      }),
    });

    if (!smsRes.ok) {
      const errText = await smsRes.text();
      console.error(`[staff-send-toolkit] SMS send failed: ${smsRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to send SMS" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-send-toolkit] Error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
