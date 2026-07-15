// Shared ownership gate for the client/partner ("portal"/"partner") endpoints.
//
// WHY THIS EXISTS
// Every owned endpoint used to inline the same auth block by hand: read the
// Bearer token, verify it, pull contactId off the payload, check the per-contact
// revoke flag, and (for partner endpoints) assert the partner audience and the
// affiliate-partner tag. When that block is copy-pasted per endpoint, one
// endpoint can drift or forget a check and leak another user's data. That is the
// IDOR class this file closes: a new owned endpoint calls one gate instead of
// re-deriving the same logic.
//
// THE INVARIANT
// Ownership ALWAYS comes from the verified JWT (tokenPayload.contactId). It is
// NEVER read from a request-supplied id (query, body, or route params). The gate
// returns the token-derived contactId, and loadOwnedContact builds the GHL
// contact-fetch URL from that id only. A request that carries a different
// contactId has no effect on which record is loaded.

import { verifySessionToken } from "./auth.js";
import { isContactRevoked } from "./session-guard.js";
import { ghlHeaders, getGhlToken } from "./ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

// Canonical error strings, mirrored from portal-data.js / partner-data.js so the
// gate's default behavior matches the endpoints it replaces. Endpoints whose
// wording differs pass a `messages` override rather than re-implementing the
// checks.
const DEFAULT_MESSAGES = {
  misconfigured: "Server configuration error",
  notAuthenticated: "Not authenticated",
  invalidToken: "Session expired. Please log in again.",
  wrongAudience: "This area is for partners.",
  missingContactId: "Not authenticated",
  revoked: "Session expired. Please log in again.",
  contactFetchFailed: "Unable to load your data. Please try again.",
  tagMissing: "Your partner access is no longer active.",
};

// The gate primitive. Centralizes JWT_SECRET presence, Bearer presence, token
// verification, optional audience assertion, contactId presence, and the
// per-contact revoke check.
//
// Follows the { error, ... } convention from endpoint-guards.js. Returns either:
//   { error: Response }              — caller does:  if (gate.error) return gate.error;
//   { tokenPayload, contactId }      — the verified payload + token-derived id
//
// Options:
//   audience  — if set, tokenPayload.type must equal it or the gate returns 403
//   messages  — per-reason string overrides (see DEFAULT_MESSAGES)
export async function requireOwner(context, headers, { audience, messages = {} } = {}) {
  const msg = { ...DEFAULT_MESSAGES, ...messages };
  const fail = (status, message) => ({
    error: new Response(JSON.stringify({ error: message }), { status, headers }),
  });

  const secret = context.env.JWT_SECRET;
  if (!secret) return fail(500, msg.misconfigured);

  const auth = context.request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return fail(401, msg.notAuthenticated);

  let tokenPayload;
  try {
    tokenPayload = await verifySessionToken(auth.slice(7), secret);
  } catch {
    return fail(401, msg.invalidToken);
  }

  // Audience check BEFORE revocation, matching partner-data.js ordering: a
  // client/staff token must not reach a partner endpoint at all.
  if (audience && tokenPayload.type !== audience) return fail(403, msg.wrongAudience);

  // Ownership is the token's contactId, never a request id.
  const contactId = tokenPayload.contactId;
  if (!contactId) return fail(401, msg.missingContactId);

  // Per-contact kill switch — revoke one contact's live sessions without
  // rotating JWT_SECRET (which would log out everyone).
  if (await isContactRevoked(context.env.PORTAL_KV, contactId)) return fail(401, msg.revoked);

  return { tokenPayload, contactId };
}

// Convenience gate that also loads the owner's own GHL contact. This is the
// single place the contact-fetch URL is built from a token id — the id comes
// from requireOwner, never from the request.
//
// Returns either:
//   { error: Response }
//   { tokenPayload, contactId, contact, ghlToken }
//
// Options: audience + messages (passed through to requireOwner), plus:
//   requireTag — if set, the fetched contact's tags must include it or the gate
//                returns 403 (used to re-verify partner eligibility per read)
export async function loadOwnedContact(
  context,
  headers,
  { audience, requireTag, messages = {} } = {},
) {
  const msg = { ...DEFAULT_MESSAGES, ...messages };

  const gate = await requireOwner(context, headers, { audience, messages });
  if (gate.error) return gate;
  const { tokenPayload, contactId } = gate;

  const ghlToken = await getGhlToken(context);

  // The ONLY id used here is the token-derived contactId.
  const contactResponse = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    headers: ghlHeaders(ghlToken),
  });

  if (!contactResponse.ok) {
    console.error(`[owned-access] contact fetch error ${contactResponse.status} for ${contactId}`);
    return {
      error: new Response(JSON.stringify({ error: msg.contactFetchFailed }), {
        status: 422,
        headers,
      }),
    };
  }

  const contactData = await contactResponse.json();
  const contact = contactData.contact;

  if (requireTag && !((contact && contact.tags) || []).includes(requireTag)) {
    return {
      error: new Response(JSON.stringify({ error: msg.tagMissing }), {
        status: 403,
        headers,
      }),
    };
  }

  return { tokenPayload, contactId, contact, ghlToken };
}
