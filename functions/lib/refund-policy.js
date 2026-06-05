// Decide what a Stripe refund should do to a client's GHL session fields.
//
// Policy (confirmed with Eben 2026-06-05): AUTO-REVOKE only the clean case — a
// FULL refund of a fresh, un-drawn full series. Everything else (partial refund,
// non-series charge, upgrade, or a series that was already drawn down) → ALERT
// for manual review, never mutate. Conservative on purpose: wrongly stripping a
// client's access over a partial / billing-adjustment refund is worse than a
// manual touch, and refunds are rare enough that review is cheap.
//
// Why classify by the ORIGINAL amount: stripe-charges.classifyCharge nets out
// amount_refunded, so on a fully-refunded charge it sees $0 and can't tell what
// was bought. We read charge.amount (gross) instead.

import { AMOUNT_TO_SESSIONS } from './stripe-charges.js';

// Gross prices (DOLLARS) eligible for clean auto-revoke: the two full series.
// Upgrades are intentionally excluded — their post-purchase balance is
// initial+delta, which never equals the product's own session count, so they
// always fall through to manual review.
const CLEAN_SERIES_AMOUNTS = new Set([1295, 720]);

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

// charge: Stripe charge { amount, amount_refunded, description } — amounts in cents.
// state:  { sessionsRemaining } — the contact's current GHL balance.
// Returns { action: 'revoke'|'alert', reason, fields? }.
export function decideRefundAction(charge, { sessionsRemaining } = {}) {
  const amount = charge?.amount || 0;
  const refunded = charge?.amount_refunded || 0;
  const dollars = amount / 100;
  const isFullRefund = amount > 0 && refunded >= amount;
  const pkg = AMOUNT_TO_SESSIONS[dollars] || null;

  if (!isFullRefund) {
    return { action: 'alert', reason: `partial refund (${fmt(refunded)} of ${fmt(amount)}) — manual review` };
  }
  if (!CLEAN_SERIES_AMOUNTS.has(dollars)) {
    const what = pkg ? pkg.label : `${fmt(amount)} charge`;
    return { action: 'alert', reason: `full refund of ${what} — manual review (not a clean full-series case)` };
  }
  // Full refund of a full series. Auto-revoke only if the balance is exactly the
  // un-drawn series — i.e. they never used a session from it.
  if (sessionsRemaining !== pkg.sessions) {
    return {
      action: 'alert',
      reason: `full refund of ${pkg.label} but balance is ${sessionsRemaining} (expected un-drawn ${pkg.sessions}) — manual review`,
    };
  }
  return {
    action: 'revoke',
    reason: `full refund of un-drawn ${pkg.label} — auto-revoked`,
    fields: { sessionsRemaining: 0, portalAccess: false, livingPractice: false },
  };
}
