// Owed-status computation — does a client owe for sessions they've taken?
//
// Compares billable sessions ATTENDED (series-calendar visits, comps excluded)
// against sessions PAID FOR (derived from their Stripe charges; see
// stripe-charges.js). Stripe is the complete money record, so this replaces the
// old GHL-orders signal that was ~50% false.
//
// Legacy pricing: an unrecognized charge amount is an OLD price the client
// actually paid (confirmed by Eben 2026-06-04 — Scott $675, Mary Jane $475 were
// paid-in-full at old prices). So any unknown-but-present charge means "paid,
// just at a price not in the current map" → never flagged owed. New prices are
// constant, so there are no unknowns going forward and the count math is exact.

import { SERIES_CALENDAR_IDS } from './session-ledger.js';

const ATTENDED = new Set(['showed', 'completed']);

// Past, attended sessions on a billable series calendar. The partner-initial
// (comp) calendar and entrainment calendar are NOT in SERIES_CALENDAR_IDS, so
// comps and entrainments are naturally excluded — apples-to-apples with the
// `sessionsPurchased` side (entrainment/living-practice classify as 0 sessions).
export function countBillableSessionsAttended(appointments, nowMs = Date.now()) {
  let n = 0;
  for (const a of (appointments || [])) {
    if (!SERIES_CALENDAR_IDS.has(a.calendarId)) continue;
    const status = (a.appointmentStatus || a.status || '').toLowerCase();
    if (!ATTENDED.has(status)) continue;
    const startMs = new Date(a.startTime || a.start_time || 0).getTime();
    if (!Number.isFinite(startMs) || startMs >= nowMs) continue; // past only
    n += 1;
  }
  return n;
}

// Smallest unrecognized charge we'll treat as a legacy session/package payment.
// A sizeable unknown (e.g. Mary Jane's old $475 pack) is very likely real
// payment at an old price; a small stray (a $50 tip/product/miskey) is not and
// must NOT excuse genuine unpaid sessions.
const LEGACY_MIN = 150;

// Decide owed status. Pure.
//   purchased >= attended → 'square'
//   shortBy>0 + a sizeable unknown charge → 'paid-legacy' (paid at an old price)
//   shortBy>0 otherwise → 'owed'
export function computeOwedStatus({ sessionsPurchased, unknownCount, unknownMax = 0, attendedBillable }) {
  const shortBy = attendedBillable - sessionsPurchased;
  if (shortBy <= 0) {
    return { status: 'square', shortBy: 0 };
  }
  if (unknownCount > 0 && unknownMax >= LEGACY_MIN) {
    return { status: 'paid-legacy', shortBy: null, reason: 'paid at a legacy price (unrecognized amount)' };
  }
  return { status: 'owed', shortBy, confidence: sessionsPurchased === 0 ? 'high' : 'medium' };
}
