// Dual-price single-session offers.
//
// 2026-07-30 ladders:
//   Default: $285 Single + $3,000 6-week Practice + $5,400 12-week Practice
//   Founder's Circle (`founders-circle`, ~11): keep legacy $190 single and the
//   existing 4/8/upgrade/entrainment products (no raised replacements).
// This module resolves the à-la-carte single only.

import { hasFoundersCircleTag } from "./portal-helpers.js";

export const SINGLE_SESSION_NEW = Object.freeze({
  key: "new",
  productId: "6a6b8bb7a1753b65945372f1",
  priceId: "6a6b8bb7a1753b0f3f5372f5",
  name: "Single Session",
  priceLabel: "$285",
  amountCents: 28500,
  paymentLinkPath: "/payment-link/6a6b8bdda655fa0b802a7164",
  paymentLinkUrl: "https://link.amarimethod.com/payment-link/6a6b8bdda655fa0b802a7164",
});

export const SINGLE_SESSION_FOUNDERS = Object.freeze({
  key: "founders",
  productId: "6998ace59dfde469ecb2aab6",
  priceId: "6998ad0288a3f09db4845d26",
  name: "Single Follow-up Session",
  priceLabel: "$190",
  amountCents: 19000,
  paymentLinkPath: "/payment-link/6998ad0288a3f09db4845d26",
  paymentLinkUrl: "https://link.amarimethod.com/payment-link/6998ad0288a3f09db4845d26",
});

/** Resolve the à-la-carte single-session offer for a contact (or tag list). */
export function singleSessionOfferFor({ isFoundersCircle, tags } = {}) {
  const founders =
    isFoundersCircle === true ||
    (isFoundersCircle !== false && hasFoundersCircleTag(tags));
  return founders ? SINGLE_SESSION_FOUNDERS : SINGLE_SESSION_NEW;
}
