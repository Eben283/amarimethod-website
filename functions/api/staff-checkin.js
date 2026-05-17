// Cloudflare Pages Function: POST /api/staff-checkin
// Records the client's signature + acceptance of the Missed Appointment Policy
// and Practice Member Agreement when they arrive for a session.
//
// Flow:
//   1. Staff JWT auth
//   2. Validate contactId, typedName, signature image, agreement checkbox
//   3. Store the signature image + metadata in PURCHASE_KV under
//      `attestation:{contactId}:{timestamp}` (reuses existing namespace;
//      a dedicated ATTESTATION_KV would be cleaner long-term)
//   4. Tag the contact `policies-signed-{AGREEMENT_VERSION}`
//   5. Add a contact note recording the attestation (without the image
//      itself — pointer to the KV key only)

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const AGREEMENT_VERSION = "practice-member-v2026-04-17";

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
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
    }

    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const body = await context.request.json();
    const { contactId, typedName, signatureImage } = body;

    if (!contactId) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }
    if (!typedName || typeof typedName !== "string" || typedName.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Typed name is required" }), { status: 400, headers });
    }
    if (!signatureImage || !signatureImage.startsWith("data:image/")) {
      return new Response(JSON.stringify({ error: "Signature is required" }), { status: 400, headers });
    }
    // The act of signing is the agreement — no separate checkbox required.

    // Cap signature size to prevent abuse — 500KB base64 is way more than a
    // signature canvas at 600x200 produces (~30-80KB typical).
    if (signatureImage.length > 500_000) {
      return new Response(JSON.stringify({ error: "Signature image too large" }), { status: 413, headers });
    }

    const timestamp = new Date().toISOString();
    const kvKey = `attestation:${contactId}:${timestamp}`;
    const ip = context.request.headers.get("CF-Connecting-IP") || null;
    const userAgent = context.request.headers.get("User-Agent") || null;

    const attestationRecord = {
      contactId,
      typedName: typedName.trim(),
      signatureImage,
      agreementVersion: AGREEMENT_VERSION,
      signedAt: timestamp,
      staffUserId: tokenPayload.userId || tokenPayload.sub || null,
      ip,
      userAgent,
    };

    const kv = context.env.PURCHASE_KV;
    if (kv) {
      try {
        await kv.put(kvKey, JSON.stringify(attestationRecord));
      } catch (err) {
        console.error("[staff-checkin] KV write failed:", err.message);
        return new Response(JSON.stringify({ error: "Failed to store signature" }), { status: 500, headers });
      }
    } else {
      console.error("[staff-checkin] PURCHASE_KV not bound — cannot store attestation");
      return new Response(JSON.stringify({ error: "Storage not configured" }), { status: 500, headers });
    }

    // Best-effort: tag + note. Don't fail the request if these fail; the
    // legal record is the KV entry above.
    try {
      const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
      if (contactRes.ok) {
        const contactData = await contactRes.json();
        const tags = contactData.contact?.tags || [];
        const signedTag = `policies-signed-${AGREEMENT_VERSION}`;
        if (!tags.includes(signedTag)) {
          await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
            method: "PUT",
            body: JSON.stringify({ tags: [...tags, signedTag] }),
          });
        }
      }
    } catch (err) {
      console.error("[staff-checkin] Tag update failed:", err.message);
    }

    try {
      // Embed the signature inline as an HTML img tag so it lives in GHL
      // alongside the metadata, not only in our KV. GHL note rendering
      // accepts <img> with data URLs; even if a future renderer strips
      // them, the base64 bytes are preserved in the note body and
      // remain extractable.
      const noteBody = [
        `Practice policies signed`,
        ``,
        `Agreement version: ${AGREEMENT_VERSION}`,
        `Typed name: ${typedName.trim()}`,
        `Signed at: ${timestamp}`,
        `IP: ${ip || "—"}`,
        ``,
        `Backup record in staff dashboard KV: ${kvKey}`,
        ``,
        `Signature:`,
        `<img src="${signatureImage}" alt="Signature of ${typedName.trim()}" style="max-width: 480px; border: 1px solid #ccc; background: white;" />`,
      ].join("\n");

      await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: noteBody }),
      });
    } catch (err) {
      console.error("[staff-checkin] Note add failed:", err.message);
    }

    return new Response(
      JSON.stringify({ success: true, kvKey, signedAt: timestamp, agreementVersion: AGREEMENT_VERSION }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("[staff-checkin] Error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
