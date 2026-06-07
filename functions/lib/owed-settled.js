// Manually-verified "settled" overrides for the owed-for-sessions check.
//
// The owed signal (session-owed.js) compares billable sessions ATTENDED against
// sessions PAID FOR, derived from Stripe. Two real-world payment paths are
// invisible to Stripe, so they will ALWAYS false-flag as "owed":
//   - comped sessions  (Garrett gave the session free)
//   - off-platform pay (cash / Venmo / pre-Stripe charges)
// Neither leaves a Stripe trace, so there is no automatic way to clear them.
// Each contactId below was confirmed square by hand (Eben + Garrett) and is
// pinned here; a listed contact is forced to 'square' and drops off the badge.
//
// These are legacy one-offs from before Stripe was the consistent payment path —
// not an ongoing class. New clients pay via Stripe and comps live on the comp
// calendar (already excluded), so this list is not expected to grow.
//
// Verified 2026-06-04 (Eben ran the full list down with Garrett) — see
// memory/troubleshooting-log.md. Keep the reason on each so a future audit can
// re-confirm rather than re-investigate.

export const SETTLED_CONTACT_IDS = new Map([
  ["zjewEnCWTi7Q7aY8hHYD", "Igor Khizver — Garrett comped the session"],
  ["brfGSo7wRyF7MIJT8SmM", "Jon Holsbach — initial session comped, wasn't a fit"],
  ["a2GRnO95ozncUsm8Gr7C", "Ernest Lardizabal — Garrett comped a follow-up"],
  ["hwkgCO2p9DniemD0CoeC", "Sean Riordan — paid off-platform (not via Stripe)"],
  ["Rxx5ILygOjE2qSyj1Oyq", "Mirko Buchwald — paid off-platform (not via Stripe)"],
  ["LxD8tZwqP11YVuHEfoqj", "Noah Pinaire — paid off-platform (not via Stripe)"],
  ["umT57oFIilMRwanGhf84", "Tae-woo Kim — paid via Stripe; remainder settled off-platform"],
]);

// Has this contact been manually confirmed square? Pure.
export function isSettled(contactId) {
  return SETTLED_CONTACT_IDS.has(contactId);
}

// The recorded reason, or null if not pinned. Pure.
export function settledReason(contactId) {
  return SETTLED_CONTACT_IDS.get(contactId) ?? null;
}
