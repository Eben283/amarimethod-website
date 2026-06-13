// Shared appointment classification for the session-fields contract.
//
// Two distinct exclusion sets, previously copy-pasted into portal-data.js,
// staff-data.js, staff-contact.js, and staff-mark-attended.js — kept here so
// they can never drift apart (they MUST agree or the portal, staff app, and
// mark-attended decrement will disagree about the same appointment).
//
//   NON_JOURNEY  → not part of the lifetime "how far have I come?" count.
//     Pain assessments, discovery/consult calls — never a real session.
//   NON_PACKAGE  → does not draw down a prepaid package balance. Adds partner
//     initials (comped perk) and entrainments (billed separately $90) on top of
//     the non-journey set.
//
// NOTE: series-reconcile-worker/src/sync.js computeLifetimeCount holds an
// intentional fifth copy of NON_JOURNEY — it is a separate deploy unit (its own
// build root) and cannot import from functions/lib. Keep the two in sync by hand.

export const NON_JOURNEY_PATTERN = /pain assessment|discovery call|15-minute|15 minute|consultation/i;
export const NON_PACKAGE_PATTERN = /pain assessment|discovery call|15-minute|15 minute|consultation|partner|entrainment/i;

/** True when an appointment title/calendar counts toward the lifetime journey. */
export function countsTowardLifetime(titleAndCalendar) {
  return !NON_JOURNEY_PATTERN.test(titleAndCalendar || "");
}

/** True when an appointment draws down a prepaid package (sessions_remaining). */
export function drawsFromPackage(titleAndCalendar) {
  return !NON_PACKAGE_PATTERN.test(titleAndCalendar || "");
}
