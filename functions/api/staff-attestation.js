// Cloudflare Pages Function: GET /api/staff-attestation?contactId=...
// Returns the most recent practice-policies attestation record for a contact,
// reading from the same PURCHASE_KV namespace where staff-checkin writes them
// under the key pattern `attestation:{contactId}:{timestamp}`.
//
// Used by the staff CheckInPage to render a read-only "already signed" view
// — typed name, signature image, signed-at, agreement version — instead of
// presenting a blank signature pad to a client who has already signed.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import { requireProviderContactIdentity, resolveOwnedContactIdentity } from "../lib/staff-owned-contact-identity.js";

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const url = new URL(context.request.url);
    const contactReference = url.searchParams.get("contactId");
    if (!contactReference) {
      return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
    }
    const contactId = requireProviderContactIdentity(
      await resolveOwnedContactIdentity(context, contactReference),
    );

    const kv = context.env.PURCHASE_KV;
    if (!kv) {
      return new Response(JSON.stringify({ error: "Storage not configured" }), { status: 500, headers });
    }

    // List all attestation keys for this contact. KV returns keys sorted
    // lexicographically; since the timestamp suffix is ISO-8601, the LAST
    // key is the most recent signing.
    const prefix = `attestation:${contactId}:`;
    let listResult;
    try {
      listResult = await kv.list({ prefix });
    } catch (err) {
      console.error("[staff-attestation] KV list failed:", err.message);
      return new Response(JSON.stringify({ error: "Failed to read attestation" }), { status: 500, headers });
    }

    const keys = listResult.keys || [];
    if (keys.length === 0) {
      return new Response(JSON.stringify({ found: false }), { status: 200, headers });
    }

    const latestKey = keys[keys.length - 1].name;
    let raw;
    try {
      raw = await kv.get(latestKey);
    } catch (err) {
      console.error("[staff-attestation] KV get failed:", err.message);
      return new Response(JSON.stringify({ error: "Failed to read attestation" }), { status: 500, headers });
    }

    if (!raw) {
      return new Response(JSON.stringify({ found: false }), { status: 200, headers });
    }

    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "Attestation record is corrupt" }), { status: 500, headers });
    }

    return new Response(
      JSON.stringify({
        found: true,
        typedName: record.typedName,
        signatureImage: record.signatureImage,
        agreementVersion: record.agreementVersion,
        signedAt: record.signedAt,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("[staff-attestation] Error:", err.message);
    if (String(err?.code || "").startsWith("owned_") || String(err?.code || "").startsWith("provider_")) {
      const status = [400, 404, 409, 503].includes(Number(err?.status)) ? Number(err.status) : 503;
      return new Response(JSON.stringify({ error: err.message, code: err.code }), { status, headers });
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
