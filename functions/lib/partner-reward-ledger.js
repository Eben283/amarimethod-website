export const PARTNER_REWARD_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const CHARGEBACK_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

const REWARD_CENTS = Object.freeze({ 12: 25000, 24: 50000 });
const PARTNER_SESSION_ENTITLEMENT = "one Amari session";

// Labels are optional ledger metadata, never contact IDs. The first reward
// predated display labels, so its known business-facing identity is preserved
// here rather than exposing the raw CRM identifiers stored in its event.
export const LEGACY_REWARD_LABELS = Object.freeze({
  "bryan-chung-geoff-papilion-20260729": Object.freeze({
    partnerName: "Bryan Chung",
    partnerOrganization: "City Racquet Shop",
    referredName: "Geoff Papilion",
  }),
});

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const dateValue = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const eventTime = (event) => Number(event.ts) || 0;

// Projects the append-only event history into the one operational record Staff
// needs. Later correction fields deliberately supersede earlier amounts/holds;
// the source events remain unchanged.
export function summarizePartnerRewardEvents(events, { now = Date.now(), labels = LEGACY_REWARD_LABELS } = {}) {
  const byReward = new Map();
  for (const event of events || []) {
    if (!event?.reward_id) continue;
    const group = byReward.get(event.reward_id) || [];
    group.push({ ...event, detail: asObject(event.detail) });
    byReward.set(event.reward_id, group);
  }

  return [...byReward.entries()].map(([rewardId, history]) => {
    history.sort((a, b) => eventTime(a) - eventTime(b));
    const attributed = history.find((event) => event.type === "attributed");
    const purchase = history.find((event) => event.type === "qualifying_purchase");
    const corrections = history.filter((event) => event.type === "correction");
    const paid = history.filter((event) => event.type === "paid").at(-1);
    const blocked = history.filter((event) => ["expired", "refunded", "disputed", "voided"].includes(event.type)).at(-1);
    const effective = [purchase, ...history.filter((event) => event.type === "chargeback_hold"), ...corrections]
      .filter(Boolean)
      .reduce((state, event) => ({ ...state, ...event.detail }), {});
    const display = { ...(labels[rewardId] || {}), ...asObject(attributed?.detail) };
    const holdUntil = dateValue(effective.holdUntil);
    const paidDetail = asObject(paid?.detail);
    const blockedType = blocked?.type || null;
    const paidAt = dateValue(paidDetail.paidAt);
    const holdElapsed = Boolean(holdUntil) && now >= Date.parse(holdUntil);
    const status = paid ? "paid" : blockedType ? blockedType : holdElapsed ? "payable" : "chargeback_hold";

    return {
      rewardId,
      partnerName: display.partnerName || "Partner identity needs review",
      partnerOrganization: display.partnerOrganization || null,
      referredName: display.referredName || "Referred person needs review",
      referralAt: dateValue(attributed?.detail?.referralAt),
      purchasedAt: dateValue(effective.purchasedAt),
      sessionCount: Number(effective.sessionCount) || null,
      amountCents: Number.isFinite(effective.amountCents) ? effective.amountCents : null,
      sessionEntitlement: typeof effective.sessionEntitlement === "string" ? effective.sessionEntitlement : null,
      holdUntil,
      status,
      canRecordPayout: status === "payable",
      payoutReference: typeof paidDetail.payoutReference === "string" ? paidDetail.payoutReference : null,
      paidAt,
      corrected: corrections.length > 0,
    };
  }).sort((a, b) => Date.parse(b.purchasedAt || b.referralAt || 0) - Date.parse(a.purchasedAt || a.referralAt || 0));
}

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
