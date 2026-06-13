// Cloudflare Pages Function: POST /api/cos-auth
// PIN auth for Chief of Staff app — same pattern as staff-auth.js

import { checkPinAttempts, recordFailedPinAttempt, clearPinAttempts } from "../lib/rate-limit.js";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  // LOW-2: echo the origin only when allow-listed; omit ACAO otherwise instead
  // of returning a constant origin that reads like an allowlist but isn't.
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
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
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Brute-force guard: cap wrong PINs per IP before checking the PIN.
    const ip = context.request.headers.get("CF-Connecting-IP") || "";
    const gate = await checkPinAttempts(context.env.PORTAL_KV, { ip, scope: "cos" });
    if (!gate.ok) {
      return new Response(JSON.stringify({ error: gate.error }), { status: gate.status, headers });
    }

    // Check PIN against each user's env var
    const cosUsers = [
      { envKey: "COS_PIN_EBEN", name: "Eben" },
      { envKey: "COS_PIN_GARRETT", name: "Garrett" },
    ];

    let matchedUser = null;
    const pinBytes = new TextEncoder().encode(pin);

    for (const user of cosUsers) {
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
      await recordFailedPinAttempt(context.env.PORTAL_KV, { ip, scope: "cos", count: gate.count });
      return new Response(
        JSON.stringify({ error: "Incorrect PIN." }),
        { status: 401, headers }
      );
    }

    // Correct PIN — clear the per-IP failure counter.
    await clearPinAttempts(context.env.PORTAL_KV, { ip, scope: "cos" });

    const token = await createToken(
      {
        role: "cos",
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
    console.error("[cos-auth] Error:", err.message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
