export const PARTNER_REWARD_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const CHARGEBACK_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

const REWARD_CENTS = Object.freeze({ 12: 25000, 24: 50000 });
const PARTNER_SESSION_ENTITLEMENT = "one Amari session";

// Pure policy gate used by the manual Staff ledger. It never pays, messages,
// mutates GHL, or treats an Assessment/booking as a qualifying purchase.
export function rewardForPracticePurchase({ referralAt, purchasedAt, sessionCount }) {
  const referred = Date.parse(referralAt);
  const purchased = Date.parse(purchasedAt);
  if (!REWARD_CENTS[sessionCount]) return { qualifies: false, reason: "not-practice" };
  if (!Number.isFinite(referred) || !Number.isFinite(purchased) || purchased < referred || purchased - referred > PARTNER_REWARD_WINDOW_MS) {
    return { qualifies: false, reason: "referral-expired" };
  }
  return {
    qualifies: true,
    amountCents: REWARD_CENTS[sessionCount],
    sessionEntitlement: PARTNER_SESSION_ENTITLEMENT,
    holdUntil: new Date(purchased + CHARGEBACK_HOLD_MS).toISOString(),
  };
}
