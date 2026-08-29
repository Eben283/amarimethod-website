// Cloudflare Pages Function: POST /api/staff-checkin
// Records the client's signature + acceptance of the Missed Appointment Policy
// when they arrive for a session.
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

import { ghlFetch, applyTagDelta } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { requireProviderContactIdentity, resolveOwnedContactIdentity } from "../lib/staff-owned-contact-identity.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const AGREEMENT_VERSION = "practice-member-v2026-04-17";


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
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const { body, error: parseError } = await parseJsonBody(context.request, headers);



    if (parseError) return parseError;
    const { contactId: contactReference, typedName, signatureImage } = body;

    if (!contactReference) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }
    const identity = await resolveOwnedContactIdentity(context, contactReference);
    const contactId = requireProviderContactIdentity(identity);
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
      contactId: identity.ownedContactId,
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
    // legal record is the KV entry above. Use the dedicated tag endpoint
    // (additive) rather than a full-array PUT so concurrent contact writes
    // don't clobber each other's tags. Re-adding a present tag is a no-op,
    // so no read-before-write is needed.
    try {
      const signedTag = `policies-signed-${AGREEMENT_VERSION}`;
      await applyTagDelta(context, contactId, { add: [signedTag] });
    } catch (err) {
      console.error("[staff-checkin] Tag update failed:", err.message);
    }

    try {
      // The signature image lives in the KV attestation record above (the legal
      // record). We deliberately DO NOT embed the base64 <img> in the note body:
      // inlining a ~50KB data-URL breaks every view that renders the note as text
      // (it dumps a wall of base64) and bloats each note. The KV key is the pointer.
      const noteBody = [
        `Practice policies signed`,
        ``,
        `Agreement version: ${AGREEMENT_VERSION}`,
        `Typed name: ${typedName.trim()}`,
        `Signed at: ${timestamp}`,
        `IP: ${ip || "—"}`,
        ``,
        `Signature on file — stored in the staff dashboard KV: ${kvKey}`,
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
    if (String(err?.code || "").startsWith("owned_") || String(err?.code || "").startsWith("provider_")) {
      const status = [400, 404, 409, 503].includes(Number(err?.status)) ? Number(err.status) : 503;
      return new Response(JSON.stringify({ error: err.message, code: err.code }), { status, headers });
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
