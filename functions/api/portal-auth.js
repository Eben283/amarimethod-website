// Cloudflare Pages Function: POST /api/portal-auth
// Accepts { email }, verifies contact exists in GHL,
// generates a magic link token, and triggers email via GHL

import { ghlHeaders, getGhlToken, applyTagDelta } from "../lib/ghl.js";
import { reserveAuthSlot } from "../lib/rate-limit.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

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
  // LOW-2: echo the origin only when allow-listed; omit ACAO otherwise instead
  // of returning a constant origin that reads like an allowlist but isn't.
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

function mintOtpCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
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

// Look up a contact by email in GHL using multiple fallback strategies
async function findContactByEmail(email, apiKey) {
  // Strategy 1: GET /contacts/search/duplicate — designed for email lookup
  try {
    const dupeUrl = `${GHL_API_BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
    // LOW-3: do not log the URL — it carries the email (PII).
    const dupeResponse = await fetch(dupeUrl, {
      method: "GET",
      headers: ghlHeaders(apiKey),
    });
    if (dupeResponse.ok) {
      const dupeData = await dupeResponse.json();
      // Response may have { contact: {...} } or { contacts: [...] }
      if (dupeData.contact && dupeData.contact.id) {
        return dupeData.contact;
      }
      if (dupeData.contacts && dupeData.contacts.length > 0) {
        return dupeData.contacts[0];
      }
    }
  } catch (err) {
    console.error(`[portal-auth] Duplicate search error: ${err.message}`);
  }

  // Strategy 2: GET /contacts/ with query parameter — list contacts filtered by email
  try {
    const listUrl = `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`;
    // LOW-3: do not log the URL — it carries the email (PII).
    const listResponse = await fetch(listUrl, {
      method: "GET",
      headers: ghlHeaders(apiKey),
    });
    if (listResponse.ok) {
      const listData = await listResponse.json();
      const contacts = listData.contacts || [];
      // Find exact email match
      const match = contacts.find(
        (c) => (c.email || "").toLowerCase() === email.toLowerCase()
      );
      if (match) {
        return match;
      }
    }
  } catch (err) {
    console.error(`[portal-auth] Contacts list error: ${err.message}`);
  }

  // Strategy 3: POST /contacts/search — advanced search
  try {
    const searchUrl = `${GHL_API_BASE}/contacts/search`;
    const searchBody = {
      locationId: GHL_LOCATION_ID,
      filters: [
        {
          field: "email",
          operator: "eq",
          value: email,
        },
      ],
    };
    console.log(`[portal-auth] Trying advanced search`);
    const searchResponse = await fetch(searchUrl, {
      method: "POST",
      headers: ghlHeaders(apiKey),
      body: JSON.stringify(searchBody),
    });
    console.log(`[portal-auth] Advanced search status: ${searchResponse.status}`);
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      console.log(`[portal-auth] Advanced search response keys: ${Object.keys(searchData).join(", ")}`);
      const contacts = searchData.contacts || [];
      if (contacts.length > 0) {
        return contacts[0];
      }
    }
  } catch (err) {
    console.error(`[portal-auth] Advanced search error: ${err.message}`);
  }

  return null;
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
    // LOW-4: reject oversized bodies before parsing — endpoint only needs {email}.
    const contentLength = parseInt(context.request.headers.get("content-length") || "0", 10);
    if (contentLength > 2048) {
      return new Response(
        JSON.stringify({ error: "Request too large." }),
        { status: 413, headers }
      );
    }

    const body = await context.request.json();
    const email = (body.email || "").trim().toLowerCase();

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid email address." }),
        { status: 400, headers }
      );
    }

    // Abuse protection (HIGH-1 + MEDIUM-2): per-email cooldown + per-IP window +
    // global daily ceiling, RESERVED here BEFORE any GHL work so a flood for one
    // address can't trigger a flood of login emails. Fails open (logged) on a KV
    // outage so a blip doesn't lock everyone out.
    const ip = context.request.headers.get("CF-Connecting-IP") || "";
    const dateKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const slot = await reserveAuthSlot(context.env.PORTAL_KV, { ip, email, scope: "portal", dateKey });
    if (!slot.ok) {
      return new Response(JSON.stringify({ error: slot.error }), { status: slot.status, headers });
    }

    const GHL_API_KEY = await getGhlToken(context);
    const JWT_SECRET = context.env.JWT_SECRET;

    if (!GHL_API_KEY || !JWT_SECRET) {
      console.error("[portal-auth] Missing env vars", {
        hasGHL: !!GHL_API_KEY,
        hasJWT: !!JWT_SECRET,
      });
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Look up contact in GHL (LOW-3: don't log the email)
    const contact = await findContactByEmail(email, GHL_API_KEY);

    if (!contact || !contact.id) {
      return new Response(
        JSON.stringify({
          error: "We don't have an account with that email. If you've had a session with us, contact hello@amarimethod.com.",
        }),
        { status: 404, headers }
      );
    }

    // Generate magic link token (24-hour expiry)
    const nonce = crypto.randomUUID();
    const token = await createToken(
      {
        contactId: contact.id,
        email: email,
        nonce: nonce,
        exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      },
      JWT_SECRET
    );

    // Store nonce in KV for single-use validation. This must SUCCEED before
    // we send the link: portal-verify treats a missing nonce as a replay and
    // rejects, so continuing past a failed put issued a link that always said
    // "already been used" (2026-07-02 audit — the old comment claimed the
    // check was optional; the verify side disagrees, correctly).
    if (context.env.PORTAL_KV) {
      try {
        await context.env.PORTAL_KV.put(`nonce:${nonce}`, "valid", {
          expirationTtl: 86400, // 24 hours
        });
      } catch (kvErr) {
        console.error(`[portal-auth] Nonce KV put failed — not sending a dead link: ${kvErr.message}`);
        return new Response(
          JSON.stringify({ error: "We couldn't create your sign-in link just now. Please try again in a minute." }),
          { status: 500, headers },
        );
      }
    }

    // Build the magic link URL (still works as a one-click fallback in the same email).
    const magicLink = `https://www.amarimethod.com/portal/verify?token=${encodeURIComponent(token)}`;

    // Prefer a stay-on-page 6-digit code — easier than hunting for a link, and
    // immune to email clients/scanners that burn one-time links (Track Clicks).
    const otpCode = mintOtpCode();
    const otpHash = await sha256Hex(otpCode);
    const otpTtlSec = 10 * 60;
    if (context.env.PORTAL_KV) {
      try {
        await context.env.PORTAL_KV.put(
          `otp:portal:${email}`,
          JSON.stringify({
            hash: otpHash,
            contactId: contact.id,
            attempts: 0,
            nonce,
            expSec: otpTtlSec,
          }),
          { expirationTtl: otpTtlSec },
        );
      } catch (otpErr) {
        console.error(`[portal-auth] OTP KV put failed: ${otpErr.message}`);
        return new Response(
          JSON.stringify({ error: "We couldn't create your sign-in code just now. Please try again in a minute." }),
          { status: 500, headers },
        );
      }
    }

    const firstName = (contact.firstName || contact.first_name || "").trim();
    const greet = firstName ? `Hi ${firstName},` : "Hi,";
    const html = `<p>${greet}</p>
<p>Your Amari Method portal sign-in code is:</p>
<p style="font-size:28px;letter-spacing:0.25em;font-weight:600">${otpCode}</p>
<p>It expires in 10 minutes. Enter it on the sign-in page (stay in this browser if you can).</p>
<p>Or open this one-time link instead:<br><a href="${magicLink}">Access Your Portal</a></p>
<p>If you didn't request this, you can ignore the email.</p>
<p>— Amari Method</p>`;

    // Primary send: Conversations Email API (one email with code + link).
    // Fallback: legacy GHL magic-link workflow if Conversations fails.
    let sentVia = "none";
    try {
      const sendRes = await fetch(`${GHL_API_BASE}/conversations/messages`, {
        method: "POST",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({
          type: "Email",
          contactId: contact.id,
          subject: "Your Amari Method portal code",
          html,
        }),
      });
      if (sendRes.ok) {
        sentVia = "conversations";
        console.log(`[portal-auth] OTP email sent via Conversations`);
      } else {
        const errText = await sendRes.text();
        console.error(`[portal-auth] Conversations email failed: ${sendRes.status} ${errText}`);
      }
    } catch (sendErr) {
      console.error(`[portal-auth] Conversations email error: ${sendErr.message}`);
    }

    if (sentVia !== "conversations") {
      // Legacy path: write magic link field + tag so GHL workflow emails the link.
      try {
        const fieldResponse = await fetch(`${GHL_API_BASE}/contacts/${contact.id}`, {
          method: "PUT",
          headers: ghlHeaders(GHL_API_KEY),
          body: JSON.stringify({
            customFields: [
              { id: "7u8Uu7a1p3KUcu0sgvoQ", field_value: magicLink },
            ],
          }),
        });
        if (!fieldResponse.ok) {
          const errText = await fieldResponse.text();
          console.error(`[portal-auth] Failed to set portal_magic_link: ${fieldResponse.status} ${errText}`);
        }
      } catch (fieldErr) {
        console.error(`[portal-auth] Field update error: ${fieldErr.message}`);
      }
      try {
        await applyTagDelta(context, contact.id, { add: ["portal-login-requested"] });
        sentVia = "ghl-workflow";
        console.log(`[portal-auth] portal-login-requested tag added (fallback)`);
      } catch (tagErr) {
        console.error(`[portal-auth] Tag update error: ${tagErr.message}`);
      }
    }

    if (sentVia === "none") {
      return new Response(
        JSON.stringify({ error: "We couldn't send your sign-in email just now. Please try again in a minute." }),
        { status: 422, headers },
      );
    }

    console.log(`[portal-auth] Sign-in issued via ${sentVia}`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: "code",
        message: "Check your email for a 6-digit code.",
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[portal-auth] Unexpected error:", err.message, err.stack);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
