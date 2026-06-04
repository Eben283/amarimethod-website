// Cloudflare Pages Function: POST /api/portal-auth
// Accepts { email }, verifies contact exists in GHL,
// generates a magic link token, and triggers email via GHL

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

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

    // Cooldown: prevent repeated login email requests for the same address
    if (context.env.PORTAL_KV) {
      try {
        const cooldown = await context.env.PORTAL_KV.get(`cooldown:portal:${email}`);
        if (cooldown) {
          return new Response(
            JSON.stringify({ error: "Please wait a minute before requesting another login link." }),
            { status: 429, headers }
          );
        }
      } catch (kvErr) {
        console.error(`[portal-auth] Cooldown check error: ${kvErr.message}`);
        // Continue — don't block legitimate users if KV is unavailable
      }
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

    // Store nonce in KV for single-use validation (if KV is available)
    if (context.env.PORTAL_KV) {
      try {
        await context.env.PORTAL_KV.put(`nonce:${nonce}`, "valid", {
          expirationTtl: 86400, // 24 hours
        });
        console.log(`[portal-auth] Nonce stored in KV`);
      } catch (kvErr) {
        console.error(`[portal-auth] KV put error: ${kvErr.message}`);
        // Continue anyway — nonce check is optional
      }
    }

    // Build the magic link URL
    const magicLink = `https://www.amarimethod.com/portal/verify?token=${encodeURIComponent(token)}`;

    // Step 1: Save the magic link field FIRST (must complete before tag triggers the workflow)
    // Using field ID (not key string) for reliable GHL field resolution.
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
        // Don't fail — token is valid; email merge tag will be blank but we log the issue.
      } else {
        console.log(`[portal-auth] portal_magic_link field saved`);
      }
    } catch (fieldErr) {
      console.error(`[portal-auth] Field update error: ${fieldErr.message}`);
    }

    // Step 2: Add the tag — this triggers the GHL email workflow AFTER the field is saved
    try {
      const tagResponse = await fetch(`${GHL_API_BASE}/contacts/${contact.id}`, {
        method: "PUT",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({
          tags: [...(contact.tags || []), "portal-login-requested"],
        }),
      });

      if (!tagResponse.ok) {
        const errText = await tagResponse.text();
        console.error(`[portal-auth] Failed to add tag: ${tagResponse.status} ${errText}`);
      } else {
        console.log(`[portal-auth] portal-login-requested tag added`);
      }
    } catch (tagErr) {
      console.error(`[portal-auth] Tag update error: ${tagErr.message}`);
    }

    console.log(`[portal-auth] Magic link generated`);

    // Set cooldown so the same address can't trigger another email for 60 seconds
    if (context.env.PORTAL_KV) {
      try {
        await context.env.PORTAL_KV.put(`cooldown:portal:${email}`, "1", {
          expirationTtl: 60,
        });
      } catch (kvErr) {
        console.error(`[portal-auth] Cooldown set error: ${kvErr.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Check your email for a login link.",
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
