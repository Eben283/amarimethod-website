// GHL product catalog — single source of truth for productId → product metadata.
//
// Two consumers share this map:
//   1. functions/lib/session-ledger.js → classifies invoices for the Balances
//      page + staff dashboard. Reads `classification` and `sessions`.
//   2. functions/api/ghl-invoice-webhook.js → post-purchase automation
//      (field SET, portal access, Living Practice access). Reads `seriesType`,
//      `sessionsRemaining`, `livingPractice`, `isPackagePurchase`.
//
// When you add a new product in GHL Payments → Products, add its productId
// here ONCE and both consumers pick it up.
//
// Retired products (e.g. `67f57171b6b1019c7b0233cc` "Amari Method: Follow-Up
// Sessions") are intentionally absent from this map — they classify as
// "retired" and contribute 0 sessions everywhere.

// Classification types that represent a series package purchase. The invoice
// webhook only runs its field-setting automation for these; the ledger uses
// them to compute the "earliest active package purchase date" cutoff.
export const PACKAGE_TYPES = new Set(["4-series", "8-series", "4-upgrade", "8-upgrade", "4-to-8-upgrade"]);

export const GHL_PRODUCTS = {
  // ── Series purchases (full package up-front) ──
  "69987357c839790426996114": {
    name: "8-Session Series",
    classification: "8-series",
    sessions: 8,
    seriesType: "8-session",
    sessionsRemaining: 8,
    livingPractice: true,
    isPackagePurchase: true,
  },
  "69986faa724ecd2343ebaa6e": {
    name: "4-Session Series",
    classification: "4-series",
    sessions: 4,
    seriesType: "4-session",
    sessionsRemaining: 4,
    livingPractice: false,
    isPackagePurchase: true,
  },

  // ── Upgrades (initial session + delta to reach a full package) ──
  "699873d6990b71ebc1fa26b4": {
    name: "Upgrade: Initial → 8-Session",
    classification: "8-upgrade",
    sessions: 7, // initial already counted as +1; this adds 7
    seriesType: "8-session",
    sessionsRemaining: 7,
    livingPractice: true,
    isPackagePurchase: true,
  },
  "6998739230cc6054f9bba62d": {
    name: "Upgrade: Initial → 4-Session",
    classification: "4-upgrade",
    sessions: 3, // initial already counted as +1; this adds 3
    seriesType: "4-session",
    sessionsRemaining: 3,
    livingPractice: false,
    isPackagePurchase: true,
  },

  // Upgrade: 4-Session → 8-Session ($575) — rebuilt 2026-05-10 after the
  // original GHL product was deleted. Customer has consumed their 4-pack
  // and is now extending to the full 8-pack: adds 4 more sessions and
  // unlocks Living Practice.
  "6a010952e41b442c862d3c01": {
    name: "Upgrade: 4-Session → 8-Session",
    classification: "4-to-8-upgrade",
    sessions: 4, // 4-pack already counted as +4; this adds 4
    seriesType: "8-session",
    sessionsRemaining: 4,
    livingPractice: true,
    isPackagePurchase: true,
  },

  // ── Individual sessions (not package purchases) ──
  "688a1cd770362828afbf08a2": {
    name: "Initial Session — In Person",
    classification: "initial",
    sessions: 1,
    isPackagePurchase: false,
  },
  "690b6b4d333ffa59d40c1823": {
    name: "Initial Session — Virtual",
    classification: "initial",
    sessions: 1,
    isPackagePurchase: false,
  },
  "69aee204e80b62d627d8e922": {
    name: "Follow-up Session — In Person",
    classification: "followup",
    sessions: 1,
    isPackagePurchase: false,
  },
  "69aee3ebcf9cf8ed9f6c928d": {
    name: "Follow-up Session — Virtual",
    classification: "followup",
    sessions: 1,
    isPackagePurchase: false,
  },
  "6998ace59dfde469ecb2aab6": {
    name: "Single Follow-up Session",
    classification: "followup",
    sessions: 1,
    isPackagePurchase: false,
  },
  "67b1299f080422451447bdd0": {
    name: "Pre Purchased session",
    classification: "followup",
    sessions: 1,
    isPackagePurchase: false,
  },

  // ── Non-series products (billed individually, no session count) ──
  "69c5d29c4019ce8e80e2513b": {
    name: "Entrainment",
    classification: "entrainment",
    sessions: 0, // billed individually, does not count against series
    isPackagePurchase: false,
  },
  "6998d7f2606fa79c54fa3ff5": {
    name: "Living Practice",
    classification: "living-practice",
    sessions: 0, // standalone video program
    isPackagePurchase: false,
  },
};

// Convenience: derived map for the session-ledger's classifyInvoice function.
// Shape: { [productId]: { type, sessions } }
export const LEDGER_PRODUCT_MAP = Object.fromEntries(
  Object.entries(GHL_PRODUCTS).map(([id, p]) => [
    id,
    { type: p.classification, sessions: p.sessions },
  ]),
);

// Convenience: derived map for the invoice webhook's purchase automation.
// Shape: { [productId]: { name, sessionsRemaining, seriesType, livingPractice } }
// Filtered to package purchases only (4-series, 8-series, 4-upgrade, 8-upgrade).
export const WEBHOOK_PURCHASE_MAP = Object.fromEntries(
  Object.entries(GHL_PRODUCTS)
    .filter(([, p]) => p.isPackagePurchase)
    .map(([id, p]) => [
      id,
      {
        name: p.name,
        sessionsRemaining: p.sessionsRemaining,
        seriesType: p.seriesType,
        livingPractice: p.livingPractice,
      },
    ]),
);
