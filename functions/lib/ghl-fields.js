// GHL custom-field IDs — single source of truth for the money/session fields.
//
// These IDs identify GHL custom fields on a contact. They were hand-typed as
// local consts/maps in ~15 WEB files (functions/api/*, functions/lib/*, and the
// series-reconcile / daily-audit / coach-daily worker dirs). A field ID changing
// in GHL (or a typo) used to mean hunting every copy. Now it lives here once and
// every WEB file imports it — same pattern as ghl-products.js.
//
// SCOPE: money- and session-adjacent fields only (the ones that drive the
// session-balance / package / portal-access automation). Partner-CRM fields
// (partner_stage, touch_count) and study_name are NOT here yet — see follow-ups.
//
// The worker dirs (series-reconcile-worker/, daily-audit-worker/,
// coach-daily-worker/) import this via a relative path
// (../../functions/lib/ghl-fields.js). Wrangler bundles relative imports at
// deploy, so within this repo everything collapses to one code path — the same
// way those workers already import ghl-products.js and session-ledger.js.
//
// FOLLOW-UPS (deliberately out of scope):
//   - ghl-mcp's own FIELD_IDS in ghl-client.js is a SEPARATE repo and cannot
//     import this file. It stays hand-typed; the advisory linter only warns.
//   - Partner (partner_stage KfPow1mYDxJqiOCS6mDZ, touch_count qKtPT2XZP61emgUDK7fd)
//     and study_name (1xhxStKyEN47shwjOKC0) are not covered here.

export const FIELD_IDS = {
  // Session balance — the most contended value in the stack. Raw GHL field,
  // reconciled hourly against the derived ledger (session-ledger.js).
  sessions_remaining: "wrQSkx6BhXwDGIn1d0V4",
  // Attended-session count (monotonic).
  sessions_completed: "TE0udwVH1Km5RsKaN5H0",
  // Which package the contact is on: none / 4-session / 8-session.
  series_type: "3i93lTkmuAV49s9nh0q8",
  // Manual override lock — when set, the reconcile worker skips auto-correcting
  // sessions_remaining / sessions_completed for this contact.
  sessions_remaining_locked: "oDyLqIeq3yTkyhgXhAmk",
  // Manual "this client has a prepaid balance" flag. deriveLedger reads it as a
  // prepaid-override so a flagged contact with no matching orders isn't zeroed.
  session_prepaid: "sgQ5EbJWhvTfGVhStaOO",
  // Portal access checkbox.
  portal_access: "O0xmwyRqeNK2EA1GGGye",
  // Living Practice video-program access checkbox.
  living_practice_access: "1EnVtI70jC5MTshZjWvw",

  // Native paid-booking handoff fields (written by /api/book/create-checkout,
  // read by ghl-purchase-webhook after payment). Contact GET returns these as
  // `{ id, value }` only — no fieldKey — so consumers must resolve by id.
  requested_session_slot: "U4CngR3hNQFlGHIh8TkM", // DATE in GHL — truncates time
  requested_session_slot_iso: "Qj3v47KwlOkLwmCWkqAW", // TEXT — full ISO with offset
  requested_session_calendar: "vDAcRQ998BBVeHcdAnkl",
  requested_session_type: "4UZAVKtF7aGFPM51XUz4",
};
