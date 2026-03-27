// Cloudflare Pages Function: POST /api/cos-auth
// PIN auth for Chief of Staff app — same pattern as staff-auth.js

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
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Only Eben gets COS access
    const cosPin = context.env.COS_PIN_EBEN;
    if (!cosPin) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    const pinBytes = new TextEncoder().encode(pin);
    const expectedBytes = new TextEncoder().encode(cosPin);

    let match = pinBytes.length === expectedBytes.length;
    let diff = 0;
    const len = Math.max(pinBytes.length, expectedBytes.length);
    for (let i = 0; i < len; i++) {
      diff |= (pinBytes[i] || 0) ^ (expectedBytes[i] || 0);
    }
    match = match && diff === 0;

    if (!match) {
      return new Response(
        JSON.stringify({ error: "Incorrect PIN." }),
        { status: 401, headers }
      );
    }

    const token = await createToken(
      {
        role: "cos",
        user: "Eben",
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
