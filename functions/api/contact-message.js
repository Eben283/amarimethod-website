// Cloudflare Pages Function: POST /api/contact-message
// Handles the /contact page form (site v6). Upserts a GHL contact with
// the website-contact-form tag and attaches the message as a contact
// note so it shows in the GHL conversation view.
//
// Notification to Garrett/Eben rides on a GHL workflow triggered by the
// "website-contact-form" tag — that workflow is configured in GHL, not here.

import { ghlFetch } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost:8899",
  "http://127.0.0.1:8899",
];

const MAX_NAME = 100;
const MAX_PHONE = 30;
const MAX_MESSAGE = 4000;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Cloudflare Pages branch previews (same project) for QA before go-live.
  try {
    const host = new URL(origin).hostname;
    return host === "amarimethod-website.pages.dev" || host.endsWith(".amarimethod-website.pages.dev");
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
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

export function validateContactMessage(body) {
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim();
  const phone = String(body?.phone || "").trim();
  const message = String(body?.message || "").trim();

  if (!name || name.length > MAX_NAME) return { error: "Name required" };
  if (!isValidEmail(email)) return { error: "Valid email required" };
  if (phone.length > MAX_PHONE) return { error: "Phone number looks too long" };
  if (!message || message.length > MAX_MESSAGE) return { error: "Message required (4000 characters max)" };

  return { name, email: email.slice(0, 200), phone, message };
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
      const rateKey = `contact_message_rate:${clientIP}`;
      const currentCount = parseInt((await kv.get(rateKey)) || "0", 10);
      if (currentCount >= 10) {
        return new Response(
          JSON.stringify({ error: "Too many submissions. Please try again later." }),
          { status: 429, headers },
        );
      }
      await kv.put(rateKey, String(currentCount + 1), { expirationTtl: 3600 });
    }

    const body = await context.request.json();
    const validated = validateContactMessage(body);
    if (validated.error) {
      return new Response(JSON.stringify({ error: validated.error }), { status: 400, headers });
    }

    const [firstName, ...rest] = validated.name.split(/\s+/);
    const upsertPayload = {
      email: validated.email,
      firstName,
      lastName: rest.join(" ") || undefined,
      phone: validated.phone || undefined,
      locationId: GHL_LOCATION_ID,
      tags: ["website-contact-form"],
      source: "Website contact form",
    };

    const upsertResponse = await ghlFetch(context, `${GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      console.error(`[contact-message] GHL upsert error: ${upsertResponse.status} ${errorText}`);
      return new Response(JSON.stringify({ error: "Failed to save" }), { status: 422, headers });
    }

    const upsertData = await upsertResponse.json();
    const contactId = upsertData.contact?.id;
    console.log(`[contact-message] Contact upserted: ${contactId || "unknown"}`);

    // Attach the message as a note. The submission already succeeded from the
    // visitor's perspective, so a note failure is logged, not surfaced.
    if (contactId) {
      const noteResponse = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        body: JSON.stringify({
          body: `Website contact form:\n\n${validated.message}`,
        }),
      });
      if (!noteResponse.ok) {
        const noteError = await noteResponse.text();
        console.error(`[contact-message] Note create error for ${contactId}: ${noteResponse.status} ${noteError}`);
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[contact-message] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers },
    );
  }
}
