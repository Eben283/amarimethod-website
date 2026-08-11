import { describe, expect, it } from "vitest";
import { rewardForPracticePurchase } from "./partner-reward-ledger.js";

describe("partner reward policy", () => {
  it("qualifies an attributed 12-session Practice purchase inside 90 days for a $400 30-day hold", () => {
    expect(rewardForPracticePurchase({
      referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 12,
    })).toEqual({ qualifies: true, amountCents: 40000, holdUntil: "2026-09-29T00:00:00.000Z" });
  });

  it("qualifies a 24-session Practice for $700 but never a standalone or late purchase", () => {
    expect(rewardForPracticePurchase({ referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 24 }).amountCents).toBe(70000);
    expect(rewardForPracticePurchase({ referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 1 })).toEqual({ qualifies: false, reason: "not-practice" });
    expect(rewardForPracticePurchase({ referralAt: "2026-08-01T00:00:00Z", purchasedAt: "2026-11-01T00:00:00Z", sessionCount: 12 })).toEqual({ qualifies: false, reason: "referral-expired" });
  });
});
