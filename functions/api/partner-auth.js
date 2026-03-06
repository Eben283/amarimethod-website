// Cloudflare Pages Function: POST /api/partner-auth
// Accepts { email }, verifies contact is an approved partner in GHL,
// generates a magic link token, and triggers email via GHL workflow.

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
    "Access-Control-Allow-Headers": "Content-Type",
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

// Look up a contact by email in GHL using multiple fallback strategies
async function findContactByEmail(email, apiKey) {
  // Strategy 1: GET /contacts/search/duplicate
  try {
    const dupeUrl = `${GHL_API_BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
    const dupeResponse = await fetch(dupeUrl, {
      method: "GET",
      headers: ghlHeaders(apiKey),
    });
    if (dupeResponse.ok) {
      const dupeData = await dupeResponse.json();
      if (dupeData.contact && dupeData.contact.id) return dupeData.contact;
      if (dupeData.contacts && dupeData.contacts.length > 0) return dupeData.contacts[0];
    }
  } catch (err) {
    console.error(`[partner-auth] Duplicate search error: ${err.message}`);
  }

  // Strategy 2: GET /contacts/ with query parameter
  try {
    const listUrl = `${GHL_API_BASE}/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`;
    const listResponse = await fetch(listUrl, {
      method: "GET",
      headers: ghlHeaders(apiKey),
    });
    if (listResponse.ok) {
      const listData = await listResponse.json();
      const contacts = listData.contacts || [];
      const match = contacts.find(
        (c) => (c.email || "").toLowerCase() === email.toLowerCase()
      );
      if (match) return match;
    }
  } catch (err) {
    console.error(`[partner-auth] Contacts list error: ${err.message}`);
  }

  // Strategy 3: POST /contacts/search — advanced search
  try {
    const searchResponse = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: ghlHeaders(apiKey),
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        filters: [{ field: "email", operator: "eq", value: email }],
      }),
    });
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const contacts = searchData.contacts || [];
      if (contacts.length > 0) return contacts[0];
    }
  } catch (err) {
    console.error(`[partner-auth] Advanced search error: ${err.message}`);
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
      console.error("[partner-auth] Missing env vars");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Look up contact in GHL
    const contact = await findContactByEmail(email, GHL_API_KEY);

    if (!contact || !contact.id) {
      return new Response(
        JSON.stringify({
          error: "We don't have an account with that email. Contact hello@amarimethod.com if you think this is an error.",
        }),
        { status: 404, headers }
      );
    }

    // ── Partner gate: must have affiliate-partner tag ──
    const tags = contact.tags || [];
    if (!tags.includes("affiliate-partner")) {
      console.log(`[partner-auth] Contact ${contact.id} is not a partner`);
      return new Response(
        JSON.stringify({
          error: "This portal is for approved partners. Contact hello@amarimethod.com if you think this is an error.",
        }),
        { status: 403, headers }
      );
    }

    // Generate magic link token (24-hour expiry)
    const nonce = crypto.randomUUID();
    const token = await createToken(
      {
        contactId: contact.id,
        email: email,
        type: "partner",
        nonce: nonce,
        exp: Date.now() + 24 * 60 * 60 * 1000,
      },
      JWT_SECRET
    );

    // Store nonce in KV for single-use validation (if KV is available)
    if (context.env.PORTAL_KV) {
      try {
        await context.env.PORTAL_KV.put(`partner_nonce:${nonce}`, "valid", {
          expirationTtl: 86400,
        });
      } catch (kvErr) {
        console.error(`[partner-auth] KV put error: ${kvErr.message}`);
      }
    }

    // Build the magic link URL
    const magicLink = `https://www.amarimethod.com/partner-app?token=${encodeURIComponent(token)}`;

    // Step 1: Save the magic link to the custom field FIRST
    try {
      const fieldResponse = await fetch(`${GHL_API_BASE}/contacts/${contact.id}`, {
        method: "PUT",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({
          customFields: [
            { id: "YPn8xn8xVynHCbw6YxFE", field_value: magicLink },
          ],
        }),
      });
      if (!fieldResponse.ok) {
        const errText = await fieldResponse.text();
        console.error(`[partner-auth] Failed to set partner_magic_link: ${fieldResponse.status} ${errText}`);
      } else {
        console.log(`[partner-auth] partner_magic_link field saved`);
      }
    } catch (fieldErr) {
      console.error(`[partner-auth] Field update error: ${fieldErr.message}`);
    }

    // Step 2: Add the tag — this triggers the GHL email workflow AFTER the field is saved
    try {
      const tagResponse = await fetch(`${GHL_API_BASE}/contacts/${contact.id}`, {
        method: "PUT",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({
          tags: [...tags, "partner-login-requested"],
        }),
      });
      if (!tagResponse.ok) {
        const errText = await tagResponse.text();
        console.error(`[partner-auth] Failed to add tag: ${tagResponse.status} ${errText}`);
      } else {
        console.log(`[partner-auth] partner-login-requested tag added`);
      }
    } catch (tagErr) {
      console.error(`[partner-auth] Tag update error: ${tagErr.message}`);
    }

    console.log(`[partner-auth] Magic link generated for partner: ${contact.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Check your email for a login link.",
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[partner-auth] Unexpected error:", err.message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
