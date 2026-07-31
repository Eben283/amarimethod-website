// Cloudflare Pages Function: GET /api/portal-verify?token=xxx
// Validates the magic link JWT and returns a session token

import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../lib/ops-last-run.js";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

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
  // LOW-2: echo the origin only when allow-listed; omit ACAO otherwise.
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Verify HMAC-SHA256 token
async function verifyToken(tokenString, secret) {
  const parts = tokenString.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Decode base64 signature
  const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));

  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(data));
  if (!valid) throw new Error("Invalid signature");

  const payload = JSON.parse(atob(body));
  return payload;
}

// Create a session token (longer-lived, for dashboard API calls)
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

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";

  try {
    const url = new URL(context.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "No token provided" }),
        { status: 400, headers }
      );
    }

    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      console.error("[portal-verify] JWT_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Verify the magic link token
    let payload;
    try {
      payload = await verifyToken(token, JWT_SECRET);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired login link." }),
        { status: 401, headers }
      );
    }

    // Check expiry
    if (!payload.exp || Date.now() > payload.exp) {
      return new Response(
        JSON.stringify({ error: "This login link has expired. Please request a new one." }),
        { status: 410, headers }
      );
    }

    // Check nonce (single-use) if KV is available
    // If the nonce IS found in KV: delete it to enforce single-use.
    // If NOT found: allow through — KV may have had a storage error in portal-auth.js,
    // or the nonce TTL may have expired. The HMAC signature + expiry are sufficient protection.
    if (context.env.PORTAL_KV && payload.nonce) {
      const nonceValue = await context.env.PORTAL_KV.get(`nonce:${payload.nonce}`);
      if (nonceValue) {
        // Nonce found and valid — consume it to prevent reuse
        await context.env.PORTAL_KV.delete(`nonce:${payload.nonce}`);
      } else {
        // Nonce not found — reject to prevent token replay
        console.warn(`[portal-verify] Nonce not found in KV for contact ${payload.contactId} — rejecting`);
        return new Response(
          JSON.stringify({ error: "This login link has already been used. Please request a new one." }),
          { status: 401, headers }
        );
      }
    }

    // Create a session token (30-day expiry)
    const sessionToken = await createSessionToken(
      {
        contactId: payload.contactId,
        email: payload.email,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
      JWT_SECRET
    );

    console.log(`[portal-verify] Session created for contact: ${payload.contactId}`);

    await writeOpsLastRun(context.env, OPS_LAST_RUN_KEYS.portalVerify, {
      status: "ok",
      contactId: payload.contactId,
    });

    return new Response(
      JSON.stringify({
        sessionToken,
        contactId: payload.contactId,
        email: payload.email,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[portal-verify] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
