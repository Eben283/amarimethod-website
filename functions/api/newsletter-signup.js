// Cloudflare Pages Function: POST /api/newsletter-signup
// Email capture for the sitewide footer newsletter form (site v6).
// Upserts a GHL contact with the newsletter tag; sending the actual
// newsletter is a GHL workflow concern, not this endpoint's.

import { ghlFetch } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const kv = context.env.PORTAL_KV;
    if (kv) {
      const clientIP = context.request.headers.get("CF-Connecting-IP") || "unknown";
      const rateKey = `newsletter_signup_rate:${clientIP}`;
      const currentCount = parseInt((await kv.get(rateKey)) || "0", 10);
      if (currentCount >= 30) {
        return new Response(
          JSON.stringify({ error: "Too many submissions. Please try again later." }),
          { status: 429, headers },
        );
      }
      await kv.put(rateKey, String(currentCount + 1), { expirationTtl: 3600 });
    }

    const body = await context.request.json();
    const { email } = body;

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: "Valid email required" }),
        { status: 400, headers },
      );
    }

    const upsertPayload = {
      email: String(email).trim().slice(0, 200),
      locationId: GHL_LOCATION_ID,
      tags: ["newsletter-subscriber"],
      source: "Website footer newsletter",
    };

    const upsertResponse = await ghlFetch(context, `${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      console.error(`[newsletter-signup] GHL upsert error: ${upsertResponse.status} ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to save" }),
        { status: 422, headers },
      );
    }

    const upsertData = await upsertResponse.json();
    console.log(`[newsletter-signup] Contact upserted: ${upsertData.contact?.id || "unknown"}`);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[newsletter-signup] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers },
    );
  }
}
