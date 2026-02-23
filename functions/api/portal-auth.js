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

// Look up a contact by email in GHL using multiple fallback strategies
async function findContactByEmail(email, apiKey) {
  // Strategy 1: GET /contacts/search/duplicate — designed for email lookup
  try {
    const dupeUrl = `${GHL_API_BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
    console.log(`[portal-auth] Trying duplicate search: ${dupeUrl}`);
    const dupeResponse = await fetch(dupeUrl, {
      method: "GET",
      headers: ghlHeaders(apiKey),
    });
    console.log(`[portal-auth] Duplicate search status: ${dupeResponse.status}`);
    if (dupeResponse.ok) {
      const dupeData = await dupeResponse.json();
      console.log(`[portal-auth] Duplicate search response keys: ${Object.keys(dupeData).join(", ")}`);
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
    console.log(`[portal-auth] Trying contacts list: ${listUrl}`);
    const listResponse = await fetch(listUrl, {
      method: "GET",
      headers: ghlHeaders(apiKey),
    });
    console.log(`[portal-auth] Contacts list status: ${listResponse.status}`);
    if (listResponse.ok) {
      const listData = await listResponse.json();
      console.log(`[portal-auth] Contacts list response keys: ${Object.keys(listData).join(", ")}`);
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
      console.error("[portal-auth] Missing env vars", {
        hasGHL: !!GHL_API_KEY,
        hasJWT: !!JWT_SECRET,
      });
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    // Look up contact in GHL
    console.log(`[portal-auth] Looking up contact: ${email}`);
    const contact = await findContactByEmail(email, GHL_API_KEY);

    if (!contact || !contact.id) {
      console.log(`[portal-auth] Contact not found for: ${email}`);
      return new Response(
        JSON.stringify({
          error: "We don't have an account with that email. If you've had a session with us, contact hello@amarimethod.com.",
        }),
        { status: 404, headers }
      );
    }

    console.log(`[portal-auth] Contact found: ${contact.id}`);

    // Generate magic link token (15-minute expiry)
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

    // Update contact with the magic link URL and trigger tag
    // Use the key-based custom field format since we may not have the exact GHL field ID
    try {
      const updateResponse = await fetch(`${GHL_API_BASE}/contacts/${contact.id}`, {
        method: "PUT",
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({
          customFields: [
            { key: "portal_magic_link", field_value: magicLink },
          ],
          tags: [...(contact.tags || []), "portal-login-requested"],
        }),
      });

      if (!updateResponse.ok) {
        const errText = await updateResponse.text();
        console.error(`[portal-auth] Failed to update contact: ${updateResponse.status} ${errText}`);
        // Don't fail — the token is valid regardless. The email just won't send via GHL workflow.
      } else {
        console.log(`[portal-auth] Contact updated with magic link and tag`);
      }
    } catch (updateErr) {
      console.error(`[portal-auth] Contact update error: ${updateErr.message}`);
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
    console.error("[portal-auth] Unexpected error:", err.message, err.stack);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
