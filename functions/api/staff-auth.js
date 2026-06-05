// Cloudflare Pages Function: POST /api/staff-auth
// Accepts { pin }, validates against per-user PIN env vars, returns 30-day JWT
// Env vars: STAFF_PIN_GARRETT, STAFF_PIN_EBEN (each a 4-8 digit PIN)

import { checkPinAttempts, recordFailedPinAttempt, clearPinAttempts } from "../lib/rate-limit.js";

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
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const body = await context.request.json();
    const pin = (body.pin || "").trim();

    if (!pin || pin.length < 4 || pin.length > 8) {
      return new Response(
        JSON.stringify({ error: "Invalid PIN format." }),
        { status: 400, headers }
      );
    }

    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      console.error("[staff-auth] Missing JWT_SECRET env var");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Brute-force guard: cap wrong PINs per IP before checking the PIN.
    const ip = context.request.headers.get("CF-Connecting-IP") || "";
    const gate = await checkPinAttempts(context.env.PORTAL_KV, { ip, scope: "staff" });
    if (!gate.ok) {
      return new Response(JSON.stringify({ error: gate.error }), { status: gate.status, headers });
    }

    // Check PIN against each staff member's env var
    const staffUsers = [
      { envKey: "STAFF_PIN_GARRETT", name: "Garrett" },
      { envKey: "STAFF_PIN_EBEN", name: "Eben" },
    ];

    let matchedUser = null;
    const pinBytes = new TextEncoder().encode(pin);

    for (const user of staffUsers) {
      const userPin = context.env[user.envKey];
      if (!userPin) continue;

      const expectedBytes = new TextEncoder().encode(userPin);
      if (pinBytes.length !== expectedBytes.length) continue;

      let diff = 0;
      for (let i = 0; i < pinBytes.length; i++) {
        diff |= pinBytes[i] ^ expectedBytes[i];
      }
      if (diff === 0) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      await recordFailedPinAttempt(context.env.PORTAL_KV, { ip, scope: "staff", count: gate.count });
      return new Response(
        JSON.stringify({ error: "Incorrect PIN." }),
        { status: 401, headers }
      );
    }

    // Correct PIN — clear the per-IP failure counter.
    await clearPinAttempts(context.env.PORTAL_KV, { ip, scope: "staff" });

    // Generate 30-day session token with user identity
    const token = await createToken(
      {
        role: "staff",
        user: matchedUser.name,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
      JWT_SECRET
    );

    return new Response(
      JSON.stringify({ token }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[staff-auth] Unexpected error:", err.message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
