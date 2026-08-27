import { describe, expect, it } from "vitest";
import { rewardForPracticePurchase, summarizePartnerRewardEvents } from "./partner-reward-ledger.js";

describe("partner reward policy", () => {
  it("qualifies an attributed 12-session Practice purchase for $250 plus one Amari session after a 30-day hold", () => {
    expect(rewardForPracticePurchase({
      referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 12,
    })).toEqual({ qualifies: true, amountCents: 25000, sessionEntitlement: "one Amari session", holdUntil: "2026-09-29T00:00:00.000Z" });
  });

  it("qualifies a 24-session Practice for $500 plus one Amari session but never a standalone or late purchase", () => {
    expect(rewardForPracticePurchase({ referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 24 })).toMatchObject({ amountCents: 50000, sessionEntitlement: "one Amari session" });
    expect(rewardForPracticePurchase({ referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 1 })).toEqual({ qualifies: false, reason: "not-practice" });
    expect(rewardForPracticePurchase({ referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-11-01T00:00:00Z", sessionCount: 12 })).toEqual({ qualifies: false, reason: "referral-expired" });
  });
});

describe("partner reward operational projection", () => {
  const events = [
    { reward_id: "bryan-chung-geoff-papilion-20260729", ts: 1, type: "attributed", detail: { referralAt: "2026-07-29T00:00:00.000Z" } },
    { reward_id: "bryan-chung-geoff-papilion-20260729", ts: 2, type: "qualifying_purchase", detail: { purchasedAt: "2026-08-10T00:00:00.000Z", sessionCount: 24, amountCents: 70000, holdUntil: "2026-09-09T00:00:00.000Z" } },
    { reward_id: "bryan-chung-geoff-papilion-20260729", ts: 3, type: "chargeback_hold", detail: { holdUntil: "2026-09-09T00:00:00.000Z" } },
    { reward_id: "bryan-chung-geoff-papilion-20260729", ts: 4, type: "correction", detail: { amountCents: 50000, sessionEntitlement: "one Amari session", holdUntil: "2026-09-09T00:00:00.000Z" } },
  ];

  it("folds D1 events into the Staff summary and lets a correction supersede a stale amount", () => {
    expect(summarizePartnerRewardEvents(events, { now: Date.parse("2026-08-26T00:00:00Z") })).toEqual([expect.objectContaining({
      partnerName: "Bryan Chung", partnerOrganization: "City Racquet Shop", referredName: "Geoff Papilion", sessionCount: 24, amountCents: 50000, sessionEntitlement: "one Amari session", status: "chargeback_hold", canRecordPayout: false, payoutReference: null,
    })]);
  });

  it("distinguishes an unpaid reward from a paid reward", () => {
    expect(summarizePartnerRewardEvents(events, { now: Date.parse("2026-09-10T00:00:00Z") })[0]).toMatchObject({ status: "payable", canRecordPayout: true, payoutReference: null });
    expect(summarizePartnerRewardEvents([...events, { reward_id: "bryan-chung-geoff-papilion-20260729", ts: 5, type: "paid", detail: { payoutReference: "check-8", paidAt: "2026-09-10T12:00:00.000Z" } }], { now: Date.parse("2026-09-10T00:00:00Z") })[0]).toMatchObject({ status: "paid", canRecordPayout: false, payoutReference: "check-8" });
  });
});
