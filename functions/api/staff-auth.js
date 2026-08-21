// Cloudflare Pages Function: POST /api/staff-auth
// Accepts { pin }, validates against per-user PIN env vars, returns 30-day JWT
// Env vars: STAFF_PIN_GARRETT, STAFF_PIN_EBEN (each a 4-8 digit PIN)

import { checkPinAttempts, recordFailedPinAttempt, clearPinAttempts, pinRateLimitKv } from "../lib/rate-limit.js";
import { STAFF_SESSION_COOKIE } from "../lib/endpoint-guards.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../lib/ops-last-run.js";

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
      console.error("[staff-auth] Missing JWT_SECRET env var");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Brute-force guard: cap wrong PINs per IP before checking the PIN.
    const ip = context.request.headers.get("CF-Connecting-IP") || "";
    const rateLimitKv = pinRateLimitKv(context.env);
    const gate = await checkPinAttempts(rateLimitKv, { ip, scope: "staff" });
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
      await recordFailedPinAttempt(rateLimitKv, { ip, scope: "staff", count: gate.count });
      return new Response(
        JSON.stringify({ error: "Incorrect PIN." }),
        { status: 401, headers }
      );
    }

    // Correct PIN — clear the per-IP failure counter.
    await clearPinAttempts(rateLimitKv, { ip, scope: "staff" });

    // Generate 30-day session token with user identity
    const token = await createToken(
      {
        role: "staff",
        user: matchedUser.name,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
      JWT_SECRET
    );

    await writeOpsLastRun(context.env, OPS_LAST_RUN_KEYS.staffAuth, {
      status: "ok",
      user: matchedUser.name,
    });

    return new Response(
      JSON.stringify({ authenticated: true, user: matchedUser.name }),
      {
        status: 200,
        headers: {
          ...headers,
          "Cache-Control": "no-store",
          "Set-Cookie": `${STAFF_SESSION_COOKIE}=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; Secure; SameSite=Strict`,
        },
      }
    );
  } catch (err) {
    console.error("[staff-auth] Unexpected error:", err.message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
