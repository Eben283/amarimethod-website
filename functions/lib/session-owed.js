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

// Decide owed status. Pure.
//   unknownCount > 0  → 'paid-legacy' (real charge at an old price = paid; never owed)
//   purchased >= attended → 'square'
//   else → 'owed' (shortBy = attended - purchased; high confidence when nothing paid)
export function computeOwedStatus({ sessionsPurchased, unknownCount, attendedBillable }) {
  if (unknownCount > 0) {
    return { status: 'paid-legacy', shortBy: null, reason: 'paid at a legacy price (amount not in current map)' };
  }
  const shortBy = attendedBillable - sessionsPurchased;
  if (shortBy <= 0) {
    return { status: 'square', shortBy: 0 };
  }
  return { status: 'owed', shortBy, confidence: sessionsPurchased === 0 ? 'high' : 'medium' };
}
