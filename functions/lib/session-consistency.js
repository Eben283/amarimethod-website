// Session-balance consistency check — a pure guard for the package-balance
// invariant at any write boundary that SETs sessions_remaining.
//
// The invariant is PACKAGE-scoped, not lifetime-scoped. portal-data.js
// (~line 217-240) documents that the two counters are independent and do NOT
// sum to a package size:
//   sessionsRemaining  — prepaid package balance ("when do I need to act?")
//   sessionsCompleted  — lifetime journey count ("how far have I come?")
// The only triplet that is guaranteed package-consistent is
//   ledger.display.attended + ledger.display.remaining === packageSize
// So this check reasons about PACKAGE-attended (sessions drawn from the
// current pack), never lifetime sessions_completed. Feeding it a lifetime
// completed count would false-flag every client who has attended sessions
// outside their current package (comps, old pay-as-you-go, entrainments).
//
// Advisory by design: callers on the money path (the purchase webhook) should
// FLAG a violation and still write, never hard-reject a paid customer. A
// blocked write on a real payment is worse than a flagged one.

/**
 * checkPackageBalance — verify a prepaid balance against its package size.
 *
 * @param {object} params
 * @param {number} params.remaining     the sessions_remaining value about to be written
 * @param {number} params.packageSize   the package's session count (SET target)
 * @param {number|null} [params.attended]  package-attended sessions, or null when
 *   not cheaply available at the boundary (bounds are still checked)
 * @returns {{ ok: boolean, violation?: string }}
 */
export function checkPackageBalance({ remaining, packageSize, attended = null }) {
  const rem = Number(remaining);
  const size = Number(packageSize);

  if (!Number.isFinite(rem)) {
    return { ok: false, violation: `remaining is not a finite number (${remaining})` };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, violation: `packageSize is not a positive number (${packageSize})` };
  }

  if (rem < 0) {
    return { ok: false, violation: `remaining ${rem} is negative` };
  }
  if (rem > size) {
    return { ok: false, violation: `remaining ${rem} exceeds packageSize ${size}` };
  }

  // Only when attended is supplied: package-attended plus what is left must not
  // exceed the pack. (attended + remaining) is the number of package slots
  // accounted for; more than packageSize means the balance was over-credited.
  if (attended !== null && attended !== undefined) {
    const att = Number(attended);
    if (!Number.isFinite(att)) {
      return { ok: false, violation: `attended is not a finite number (${attended})` };
    }
    if (att + rem > size) {
      return {
        ok: false,
        violation: `attended ${att} + remaining ${rem} exceeds packageSize ${size}`,
      };
    }
  }

  return { ok: true };
}
