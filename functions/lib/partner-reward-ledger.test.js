import { describe, expect, it } from "vitest";
import { rewardForPracticePurchase } from "./partner-reward-ledger.js";

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
