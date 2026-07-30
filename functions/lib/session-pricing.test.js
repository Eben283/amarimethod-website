import { describe, it, expect } from "vitest";
import {
  SINGLE_SESSION_NEW,
  SINGLE_SESSION_FOUNDERS,
  singleSessionOfferFor,
} from "./session-pricing.js";

describe("singleSessionOfferFor", () => {
  it("returns the $285 Single Session for everyone without the founders tag", () => {
    expect(singleSessionOfferFor({})).toBe(SINGLE_SESSION_NEW);
    expect(singleSessionOfferFor({ tags: [] })).toBe(SINGLE_SESSION_NEW);
    expect(singleSessionOfferFor({ tags: ["review-asked"] })).toBe(SINGLE_SESSION_NEW);
    expect(singleSessionOfferFor({ isFoundersCircle: false })).toBe(SINGLE_SESSION_NEW);
  });

  it("returns the legacy $190 Single Follow-up for Founder's Circle", () => {
    expect(singleSessionOfferFor({ isFoundersCircle: true })).toBe(SINGLE_SESSION_FOUNDERS);
    expect(singleSessionOfferFor({ tags: ["founders-circle"] })).toBe(SINGLE_SESSION_FOUNDERS);
    expect(singleSessionOfferFor({ tags: ["Founders-Circle"] })).toBe(SINGLE_SESSION_FOUNDERS);
  });

  it("keeps both product + payment-link identities distinct", () => {
    expect(SINGLE_SESSION_NEW.productId).toBe("6a6b8bb7a1753b65945372f1");
    expect(SINGLE_SESSION_NEW.priceId).toBe("6a6b8bb7a1753b0f3f5372f5");
    expect(SINGLE_SESSION_NEW.amountCents).toBe(28500);
    expect(SINGLE_SESSION_FOUNDERS.productId).toBe("6998ace59dfde469ecb2aab6");
    expect(SINGLE_SESSION_FOUNDERS.amountCents).toBe(19000);
    expect(SINGLE_SESSION_NEW.paymentLinkUrl).not.toBe(SINGLE_SESSION_FOUNDERS.paymentLinkUrl);
  });
});
