// Purchase confirmations — GHL exit Unit C gap (a): no code path sends a purchase
// confirmation today. This module is the ONE seam the purchase paths call after a successful
// series reconcile; it (1) cancels the contact's pending Post-Initial Upgrade Offer timer and
// (2) records/sends the series confirmation email, idempotent per order/invoice ref.
//
// The series branch runs on the RECONCILE RESULT passed in — never a re-read of the GHL
// series_type field, which the whole cluster writes (the read-back race the brief flags).
//
// Copy: the two seriesType templates are carried VERBATIM from the twin spec
// (invoice-series-purchase-notification.yaml, verified live 2026-05-04) — only the 8-session
// email mentions Living Practice, matching the package mapping. A Single/unknown series type
// gets cleanup but NO email (documented silent fall-through). 2026-07-12 builder reads
// (Eben) verified the Order-Submitted workflows use the SAME copy: the 4-series T4 email
// body is word-for-word the "4-session" template below, and the upgrades get their own
// classification variants (credit line) — so these templates now cover both the invoice and
// Order-Submitted paths byte-exact, except the 8-series body (last unverified, presumed to
// match the invoice 8-session template).
//
// Shadow is the default (MODE below): would_send is recorded on the purchase_confirmations
// ledger + automation_events, the send adapter is never called. Missing AUTOMATION_DB binding
// is a graceful skip so this can deploy before the shared D1 exists. Never throws.

import { cancelUpgradeOffer, appendAutomationEvent } from "./upgrade-offer.js";
import { sendConversationMessage } from "./ghl-send.js";

// Flip to "active" only at the purchase-cluster cutover (one release, all sources together).
const MODE = "shadow";

const FROM = Object.freeze({ name: "Amari Method", email: "eben@amarimethod.com" });

const TEMPLATES = Object.freeze({
  "4-session": Object.freeze({
    key: "confirm-4-session",
    from: FROM,
    subject: "Your 4-Session Series is confirmed, {{contact.first_name}}",
    preheader: "Here's what's next",
    body: `Hi {{contact.first_name}},

You're all set. Your 4-Session Series is confirmed.

Your client portal has everything you need: your progress tracker, session history, and booking for your next session.

Access Your Portal  → https://www.amarimethod.com/portal/

If you have any questions, reply here or call us at (628) 877-7673.

Amari Method`,
  }),
  "8-session": Object.freeze({
    key: "confirm-8-session",
    from: FROM,
    subject: "Your 8-Session Series is Confirmed, {{contact.first_name}}",
    preheader: "Here's what's next",
    body: `Hi {{contact.first_name}},

You're all set. Your 8-Session Series is confirmed and your Living Practice access is included.

Your client portal has everything you need: your progress tracker, session history, and booking for your next session.

Access Your Portal  → https://www.amarimethod.com/portal/

If you have any questions, reply here or call us at (628) 877-7673.

Amari Method`,
  }),
});

// Classification-specific variants override the seriesType default. The 8-upgrade body is
// VERBATIM from GHL-WORKFLOWS-MASTER.md C2b, confirmed live 2026-07-12 (builder AI read) —
// the upgrade variant carries the initial-credit line the plain series email lacks. The live
// body's em-dash is ported as-is; any de-slop is a separate copy change, never silent.
// RESOLVE FIRST (same builder pass): both plain-series workflows' live bodies — until then
// those sources fall back to the seriesType templates above.
const CLASSIFICATION_TEMPLATES = Object.freeze({
  "4-upgrade": Object.freeze({
    key: "confirm-4-upgrade",
    from: FROM,
    subject: "Your 4-Session Series is confirmed, {{contact.first_name}}",
    preheader: "Here's what's next.",
    body: `Hi {{contact.first_name}},

You're all set. Your 4-Session Series is confirmed — your initial session credit has been applied.

Your client portal has everything you need: your progress tracker, session history, and booking for your next session.

[Access Your Portal]  → https://www.amarimethod.com/portal/

If you have any questions, reply here or call us at (628) 877-7673.

Amari Method`,
  }),
  "8-upgrade": Object.freeze({
    key: "confirm-8-upgrade",
    from: FROM,
    subject: "Your 8-Session Series is Confirmed, {{contact.first_name}}",
    preheader: "Here's what's next.",
    body: `Hi {{contact.first_name}},

You're all set. Your 8-Session Series is confirmed — your initial session credit has been applied, and your Living Practice access is included.

Your client portal has everything you need: your progress tracker, session history, and booking for your next session.

[Access Your Portal]  → https://www.amarimethod.com/portal/

If you have any questions, reply here or call us at (628) 877-7673.

Amari Method`,
  }),
});

/**
 * The confirmation template for a reconciled purchase: the classification variant when one
 * exists, else the seriesType default, else null (Single/unknown → the documented silent
 * fall-through). Pure.
 */
export function confirmationForSeries(seriesType, classification) {
  return (
    CLASSIFICATION_TEMPLATES[String(classification ?? "")] ||
    TEMPLATES[String(seriesType ?? "")] ||
    null
  );
}

function changesOf(res) {
  return (res && res.meta && res.meta.changes) || 0;
}

/**
 * The seam. Call after a successful series reconcile (purchase webhook, invoice webhook,
 * reconcile-worker orphan path). Contract: NEVER throws; a failure here must never turn a
 * recorded payment into a webhook error.
 *
 * @param {object} context - Pages Function context ({ env })
 * @param {{contactId, seriesType, ref, source}} purchase - ref must be unique per order/invoice
 * @returns {{ok, skipped?, offerCancelled?, confirmation?, error?}}
 */
export async function recordSeriesPurchase(context, { contactId, seriesType, classification, ref, source }, nowMs) {
  const db = context.env && context.env.AUTOMATION_DB;
  if (!db) return { ok: true, skipped: "no-binding" };

  try {
    const { cancelled } = await cancelUpgradeOffer(db, contactId);
    if (cancelled) {
      await appendAutomationEvent(db, {
        ts: nowMs, flowKey: "upgrade-offer", contactId,
        action: "cancelled", outcome: "cancelled", detail: { via: source, ref },
      });
    }

    const template = confirmationForSeries(seriesType, classification);
    const status = template ? (MODE === "active" ? "sent" : "would_send") : "no_template";

    // The ledger row IS the idempotency claim: one confirmation per ref, ever.
    const claim = await db
      .prepare(
        `INSERT INTO purchase_confirmations (ref, contact_id, series_type, status, ts)
         VALUES (?,?,?,?,?)
         ON CONFLICT(ref) DO NOTHING`,
      )
      .bind(ref, contactId, seriesType ?? null, template ? "would_send" : "no_template", nowMs)
      .run();
    if (changesOf(claim) !== 1) return { ok: true, offerCancelled: cancelled, confirmation: "duplicate" };

    if (!template) return { ok: true, offerCancelled: cancelled, confirmation: "no_template" };

    if (MODE !== "active") {
      await appendAutomationEvent(db, {
        ts: nowMs, flowKey: "purchase-confirmation", contactId, channel: "email",
        action: "would_send", outcome: "would_send", detail: { template: template.key, ref, source },
      });
      return { ok: true, offerCancelled: cancelled, confirmation: "would_send" };
    }

    const res = await sendConversationMessage(context, {
      channel: "email",
      contactId,
      subject: template.subject.replace("{{contact.first_name}}", ""),
      html: template.body, // active-mode merge-field rendering is a cutover brick; MODE stays shadow until then
    });
    const ok = !!(res && res.success);
    await db
      .prepare(`UPDATE purchase_confirmations SET status = ? WHERE ref = ?`)
      .bind(ok ? "sent" : "failed", ref)
      .run();
    await appendAutomationEvent(db, {
      ts: nowMs, flowKey: "purchase-confirmation", contactId, channel: "email",
      action: "send", outcome: ok ? "sent" : "failed",
      message_ref: (res && res.messageId) || null, detail: { template: template.key, ref, source },
    });
    return { ok: true, offerCancelled: cancelled, confirmation: ok ? "sent" : "failed" };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}
