// Per-contact session kill switch (auth-jwt-audit-2026-06-04, HIGH-2).
//
// Sessions are 30-day bearer tokens with no revocation path except rotating
// JWT_SECRET — which logs out EVERY user at once. This adds a per-contact deny
// flag: set KV key `auth-revoked:{contactId}` and that contact's authenticated
// reads are denied immediately, for ALL of their existing tokens, without
// touching anyone else. Works without any token-shape change.
//
// To revoke a contact (ops / wrangler):
//   PORTAL_KV.put(`auth-revoked:{contactId}`, "1", { expirationTtl: 2592000 })
// TTL ~30d = the max session lifetime, so the flag self-clears once every
// token issued before the revoke would already have expired. No mint endpoint
// exists yet (the check is the half that matters for the audit); a staff
// "revoke access" button can write this key later.
//
// On a KV error the check FAILS OPEN (returns not-revoked) + logs — same
// availability posture as the rest of the auth layer; a KV blip shouldn't lock
// out the whole portal. The revoke window is tiny and the holder already has a
// validly-signed token.

const REVOKE_PREFIX = "auth-revoked:";

export function revokeKey(contactId) {
  return `${REVOKE_PREFIX}${contactId}`;
}

export async function isContactRevoked(kv, contactId) {
  if (!kv || !contactId) return false;
  try {
    return Boolean(await kv.get(revokeKey(contactId)));
  } catch (err) {
    console.error(`[session-guard] revoke check failed for ${contactId}: ${err.message}`);
    return false; // fail open (availability)
  }
}
