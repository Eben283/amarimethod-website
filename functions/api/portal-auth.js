// Cloudflare Pages Function: POST /api/portal-auth
// Accepts { email }, verifies contact exists in GHL,
// generates a magic link token, and triggers email via GHL

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function ghlHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Version": "2021-07-28",
  };
}

// Simple JWT-like token using HMAC-SHA256
async function createToken(payload, secret) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `${data}.${sig}`;
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
    const body = await context.request.json();
    const email = (body.email || "").trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid email address." }),
        { status: 400, headers }
      );
    }

    const GHL_API_KEY = context.env.GHL_API_KEY;
    const JWT_SECRET = context.env.JWT_SECRET;

    if (!GHL_API_KEY || !JWT_SECRET) {
      console.error("[portal-auth] Missing env vars");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Look up contact in GHL
    const lookupUrl = `${GHL_API_BASE}/contacts/lookup?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
    const lookupResponse = await fetch(lookupUrl, {
      method: "GET",
      headers: ghlHeaders(GHL_API_KEY),
    });

    if (!lookupResponse.ok) {
      if (lookupResponse.status === 404 || lookupResponse.status === 422) {
        return new Response(
          JSON.stringify({
            error: "We don't have an account with that email. If you've had a session with us, contact hello@amarimethod.com.",
          }),
          { status: 404, headers }
        );
      }
      console.error(`[portal-auth] GHL lookup error: ${lookupResponse.status}`);
      return new Response(
        JSON.stringify({ error: "Unable to verify your account. Please try again." }),
        { status: 502, headers }
      );
    }

    const lookupData = await lookupResponse.json();
    const contact = lookupData.contact;

    if (!contact || !contact.id) {
      return new Response(
        JSON.stringify({
          error: "We don't have an account with that email. If you've had a session with us, contact hello@amarimethod.com.",
        }),
        { status: 404, headers }
      );
    }

    // Generate magic link token (15-minute expiry)
    const nonce = crypto.randomUUID();
    const token = await createToken(
      {
        contactId: contact.id,
        email: email,
        nonce: nonce,
        exp: Date.now() + 15 * 60 * 1000, // 15 minutes
      },
      JWT_SECRET
    );

    // Store nonce in KV for single-use validation (if KV is available)
    if (context.env.PORTAL_KV) {
      await context.env.PORTAL_KV.put(`nonce:${nonce}`, "valid", {
        expirationTtl: 900, // 15 minutes
      });
    }

    // Send magic link email via GHL workflow trigger
    // We tag the contact to trigger a GHL workflow that sends the email
    const magicLink = `https://www.amarimethod.com/portal/verify?token=${encodeURIComponent(token)}`;

    // Update contact with the magic link URL in a custom field so the GHL workflow email template can use it
    const updateResponse = await fetch(`${GHL_API_BASE}/contacts/${contact.id}`, {
      method: "PUT",
      headers: ghlHeaders(GHL_API_KEY),
      body: JSON.stringify({
        customFields: [
          { id: "portal_magic_link", field_value: magicLink },
        ],
        tags: ["portal-login-requested"],
      }),
    });

    if (!updateResponse.ok) {
      console.error(`[portal-auth] Failed to set magic link on contact: ${updateResponse.status}`);
      // Fall back to just returning success — the token is valid regardless
    }

    console.log(`[portal-auth] Magic link generated for contact: ${contact.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Check your email for a login link.",
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[portal-auth] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
