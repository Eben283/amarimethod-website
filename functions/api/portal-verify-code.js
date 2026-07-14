// Cloudflare Pages Function: POST /api/portal-verify-code
// Exchanges a 6-digit email OTP (from portal-auth) for a 30-day portal session.
// Same session JWT shape as GET /api/portal-verify (magic link path).

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

const OTP_MAX_ATTEMPTS = 5;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "amarimethod-website.pages.dev" || host.endsWith(".amarimethod-website.pages.dev");
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createSessionToken(payload, secret) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
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
    const contentLength = parseInt(context.request.headers.get("content-length") || "0", 10);
    if (contentLength > 2048) {
      return new Response(JSON.stringify({ error: "Request too large." }), { status: 413, headers });
    }

    const body = await context.request.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const code = String(body?.code || "").trim().replace(/\s+/g, "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Please enter a valid email address." }), { status: 400, headers });
    }
    if (!/^\d{6}$/.test(code)) {
      return new Response(JSON.stringify({ error: "Enter the 6-digit code from your email." }), { status: 400, headers });
    }

    const JWT_SECRET = context.env.JWT_SECRET;
    const kv = context.env.PORTAL_KV;
    if (!JWT_SECRET || !kv) {
      console.error("[portal-verify-code] Missing JWT_SECRET or PORTAL_KV");
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    const otpKey = `otp:portal:${email}`;
    const raw = await kv.get(otpKey);
    if (!raw) {
      return new Response(
        JSON.stringify({ error: "That code has expired. Request a new one." }),
        { status: 401, headers },
      );
    }

    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      await kv.delete(otpKey);
      return new Response(JSON.stringify({ error: "That code is no longer valid. Request a new one." }), { status: 401, headers });
    }

    const attempts = Number(record.attempts || 0);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await kv.delete(otpKey);
      return new Response(
        JSON.stringify({ error: "Too many attempts. Request a new code." }),
        { status: 429, headers },
      );
    }

    const hash = await sha256Hex(code);
    if (hash !== record.hash) {
      record.attempts = attempts + 1;
      const ttlLeft = Math.max(60, Number(record.expSec || 600));
      await kv.put(otpKey, JSON.stringify(record), { expirationTtl: ttlLeft });
      return new Response(JSON.stringify({ error: "That code doesn't match. Try again." }), { status: 401, headers });
    }

    // Consume OTP + related magic-link nonce (one sign-in, either path).
    await kv.delete(otpKey);
    if (record.nonce) {
      try { await kv.delete(`nonce:${record.nonce}`); } catch { /* ignore */ }
    }

    const sessionToken = await createSessionToken(
      {
        contactId: record.contactId,
        email,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
      JWT_SECRET,
    );

    console.log(`[portal-verify-code] Session created for contact: ${record.contactId}`);
    return new Response(
      JSON.stringify({ sessionToken, contactId: record.contactId, email }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("[portal-verify-code] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
