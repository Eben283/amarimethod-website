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
export const PACKAGE_TYPES = new Set(["4-series", "8-series", "6-week", "12-week", "4-upgrade", "8-upgrade", "4-to-8-upgrade"]);

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
  "6a66cde7ef7b07f122ad46fb": {
    name: "The 12-Week Amari Practice",
    classification: "12-week",
    sessions: 24,
    seriesType: "12-week",
    sessionsRemaining: 24,
    // The at-home protocol library is part of this practice, not a bonus.
    livingPractice: true,
    isPackagePurchase: true,
  },
  "6a683360017263178d05d1a3": {
    name: "The 6-Week Amari Practice",
    classification: "6-week",
    sessions: 12,
    seriesType: "6-week",
    sessionsRemaining: 12,
    livingPractice: true,
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
    isAdditive: true, // reconcile: ADD to current balance, not SET — client may have unused 4-pack sessions
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
  "6a6b8bb7a1753b65945372f1": {
    name: "Single Session",
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
  "6a66cf0103821ea09ea13f1b": {
    name: "Amari Assessment",
    classification: "assessment",
    sessions: 0, // a paid first visit, never a prepaid practice session
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

// ── Identity: products carry TWO id systems ───────────────────────────────
// GHL gives every product a productId (the keys above) AND one or more priceIds
// (re-issued on each price edit). Orders/webhook payloads can reference EITHER.
// So every consumer must resolve both. priceIds = [current, ...historical].
// Pulled live from GHL 2026-06-06; historical entries recovered from prior code.
export const PRICE_IDS = {
  "69987357c839790426996114": ["69987357c83979a1f0996119", "699873074d5b8cc0bc0e3b5a"], // 8-Session Series
  "69986faa724ecd2343ebaa6e": ["69986faa724ecd4f9debaa73", "699872e130cc6054f9bba617"], // 4-Session Series
  "6a66cde7ef7b07f122ad46fb": ["6a66cde7ef7b076d15ad4700"], // The 12-Week Amari Practice ($5,400)
  "6a683360017263178d05d1a3": ["6a683360017263ef8a05d1a7"], // The 6-Week Amari Practice ($3,000)
  "699873d6990b71ebc1fa26b4": ["699873d6990b71a8b3fa26b9"], // Upgrade: Initial → 8
  "6998739230cc6054f9bba62d": ["6998739230cc604805bba632"], // Upgrade: Initial → 4
  "6a010952e41b442c862d3c01": ["6a010952e41b44dab12d3c06"], // Upgrade: 4 → 8
  "688a1cd770362828afbf08a2": ["688a1cd7fd14056c78c5fcbf"], // Initial — In Person
  "690b6b4d333ffa59d40c1823": ["690b6b4d6d7d7a23e2a84c51"], // Initial — Virtual
  "69aee204e80b62d627d8e922": ["69aee2041bfe9fb270652ceb"], // Follow-up — In Person (draw-down)
  "69aee3ebcf9cf8ed9f6c928d": ["69aee3ecaf297f29bc0186cb"], // Follow-up — Virtual (draw-down)
  "6998ace59dfde469ecb2aab6": ["6998ace59dfde42ec0b2aabb", "6998ad0288a3f09db4845d26"], // Single Follow-up
  "6a6b8bb7a1753b65945372f1": ["6a6b8bb7a1753b0f3f5372f5"], // Single Session @ $285
  "67b1299f080422451447bdd0": ["67b1299f0804221b3947bdd4"], // Pre Purchased (draw-down)
  "69c5d29c4019ce8e80e2513b": ["69c5d29c5b50e82344c2d6ec"], // Entrainment
  "6998d7f2606fa79c54fa3ff5": ["6998d7f2606fa7edc0fa3ffa"], // Living Practice
  "6a66cf0103821ea09ea13f1b": ["6a66cf0103821e836fa13f20"], // Amari Assessment ($29)
};

// Follow-up productIds that are DRAW-DOWNS — booked against an existing package,
// not à-la-carte purchases. They must NEVER be credited on purchase (crediting
// them would inflate the balance on every booking). Confirmed with Eben.
export const DRAW_DOWN_PRODUCT_IDS = new Set([
  "69aee204e80b62d627d8e922", // Follow-up — In Person
  "69aee3ebcf9cf8ed9f6c928d", // Follow-up — Virtual
  "67b1299f080422451447bdd0", // Pre Purchased session
]);

// Resolve ANY GHL id (productId or any priceId) → productId.
const ID_TO_PRODUCT_ID = (() => {
  const m = {};
  for (const productId of Object.keys(GHL_PRODUCTS)) {
    m[productId] = productId;
    for (const priceId of (PRICE_IDS[productId] || [])) m[priceId] = productId;
  }
  return m;
})();
export const productIdForAnyId = (anyId) => ID_TO_PRODUCT_ID[anyId] || null;
export const productForAnyId = (anyId) => {
  const pid = productIdForAnyId(anyId);
  return pid ? GHL_PRODUCTS[pid] : null;
};

// Does this product grant a session balance when purchased? Packages + à-la-carte
// single sessions (initials, Single Follow-up) do; draw-downs, entrainment, and
// Living Practice do not.
function creditsOnPurchase(productId, p) {
  if (DRAW_DOWN_PRODUCT_IDS.has(productId)) return false;
  if (
    p.classification === "entrainment" ||
    p.classification === "living-practice" ||
    p.classification === "assessment"
  ) return false;
  return p.isPackagePurchase || p.sessions >= 1;
}

// ── Derived consumer maps (the four hand-typed copies now build from here) ──

// Purchase webhook crediting. Packages SET the balance (gated by seriesType);
// single sessions ADD +1 (seriesType null). The webhook overlays its own
// booking metadata (initials) + the retired legacy follow-up locally.
export const PURCHASE_CREDIT_MAP = Object.fromEntries(
  Object.entries(GHL_PRODUCTS)
    .filter(([id, p]) => creditsOnPurchase(id, p))
    .map(([id, p]) => [
      id,
      p.isPackagePurchase
        ? { name: p.name, sessionsToAdd: p.sessionsRemaining, seriesType: p.seriesType, livingPractice: !!p.livingPractice }
        : { name: p.name, sessionsToAdd: p.sessions, seriesType: null, livingPractice: false },
    ]),
);

// Reconcile worker package map (SET semantics). Packages only. The worker
// overlays its own per-package workflowCode locally (note-text only).
export const PACKAGE_MAP = Object.fromEntries(
  Object.entries(GHL_PRODUCTS)
    .filter(([, p]) => p.isPackagePurchase)
    .map(([id, p]) => [
      id,
      { name: p.name, sessionsToSet: p.sessionsRemaining, seriesType: p.seriesType, livingPractice: !!p.livingPractice, isAdditive: !!p.isAdditive },
    ]),
);

// Daily-audit map: "after this purchase, sessions_remaining should be >= increment".
// Keyed by BOTH productIds AND priceIds (orders arrive as either), so it can no
// longer be blind to a current price id (the prior hand-typed map used stale ones).
export const AUDIT_INCREMENT_MAP = (() => {
  const m = {};
  for (const [productId, p] of Object.entries(GHL_PRODUCTS)) {
    if (!creditsOnPurchase(productId, p)) continue;
    const entry = p.isPackagePurchase
      ? { name: p.name, increment: p.sessionsRemaining, seriesType: p.seriesType }
      : { name: p.name, increment: p.sessions, seriesType: null };
    m[productId] = entry;
    for (const priceId of (PRICE_IDS[productId] || [])) m[priceId] = entry;
  }
  return m;
})();
