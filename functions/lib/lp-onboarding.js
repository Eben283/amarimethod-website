// Living Practice Onboarding — the sessions_remaining listener (GHL exit Unit C).
//
// GHL's version: contact_changed on sessions_remaining → if series_type is 8-session AND the
// value is exactly 2, send the Living Practice onboarding email. In code the event comes from
// the paths that WRITE the field (staff-mark-attended's decrement is the only writer that can
// produce 3→2; the purchase webhooks SET 8/7/4/3 and never 2) — never from polling GHL.
//
// Send-once is keyed on the CONTACT (lp_onboarding_sends, PK contact_id), not the raw field
// transition: the reconcile worker self-heals sessions_remaining hourly, so the value can pass
// through 2 more than once — a correction must never re-send. Once per contact is right in the
// product sense too: Living Practice access is granted once.
//
// Shadow default: would_send on the shared automation_events log, nothing leaves. Missing
// AUTOMATION_DB binding is a graceful skip. Never throws — callers are live money paths.
//
// If Mid-Series Check-In or Series Completion are ever revived (both currently Delete), they
// are ~20-line second consumers of this same write-path event, not new modules.

import { appendAutomationEvent } from "./upgrade-offer.js";
import { sendConversationMessage } from "./ghl-send.js";

// Flip to "active" only at the purchase-cluster cutover (one release, all sources together).
const MODE = "shadow";

// Verbatim 2026-06-17 shortened post-scrub copy (twin: living-practice-onboarding.yaml). The
// pre-6/17 longer body (bulleted list, "not just" preheader, Dr. sign-off) is RETIRED.
export const LP_ONBOARDING_EMAIL = Object.freeze({
  key: "lp-onboarding-email",
  from: Object.freeze({ name: "Garrett", email: "garrett@amarimethod.com" }),
  subject: "Your Living Practice is ready, {{contact.first_name}}",
  preheader: "Your full protocol library is ready in your portal.",
  body: `Hi {{contact.first_name}},

Your Living Practice access is ready. The full protocol library with video walkthroughs is in your portal now, worth looking at between sessions. Everything we've been working on is in there.

Access Living Practice → https://www.amarimethod.com/portal/

Garrett`,
});

function changesOf(res) {
  return (res && res.meta && res.meta.changes) || 0;
}

/**
 * Call from every code path that writes sessions_remaining, with the value it just wrote and
 * the contact's series type. Fires the onboarding email exactly once per contact when an
 * 8-session client reaches 2 remaining; everything else is a cheap no-op.
 * Returns { outcome: "would_send" | "sent" | "failed" | "duplicate" | "skip" | "error" }.
 */
export async function maybeSendLpOnboarding(context, { contactId, seriesType, newRemaining }, nowMs) {
  const db = context.env && context.env.AUTOMATION_DB;
  if (!db) return { outcome: "skip", reason: "no-binding" };

  const st = String(seriesType ?? "").trim().toLowerCase();
  if (st !== "8-session" || Number(newRemaining) !== 2) return { outcome: "skip", reason: "condition" };

  try {
    const claim = await db
      .prepare(
        `INSERT INTO lp_onboarding_sends (contact_id, status, ts)
         VALUES (?,?,?)
         ON CONFLICT(contact_id) DO NOTHING`,
      )
      .bind(contactId, MODE === "active" ? "sending" : "would_send", nowMs)
      .run();
    if (changesOf(claim) !== 1) return { outcome: "duplicate" };

    if (MODE !== "active") {
      await appendAutomationEvent(db, {
        ts: nowMs, flowKey: "lp-onboarding", contactId, channel: "email",
        action: "would_send", outcome: "would_send", detail: { template: LP_ONBOARDING_EMAIL.key },
      });
      return { outcome: "would_send" };
    }

    const res = await sendConversationMessage(context, {
      channel: "email",
      contactId,
      subject: LP_ONBOARDING_EMAIL.subject.replace("{{contact.first_name}}", ""),
      html: LP_ONBOARDING_EMAIL.body, // active-mode merge-field rendering is a cutover brick; MODE stays shadow until then
    });
    const ok = !!(res && res.success);
    await db
      .prepare(`UPDATE lp_onboarding_sends SET status = ? WHERE contact_id = ?`)
      .bind(ok ? "sent" : "failed", contactId)
      .run();
    await appendAutomationEvent(db, {
      ts: nowMs, flowKey: "lp-onboarding", contactId, channel: "email",
      action: "send", outcome: ok ? "sent" : "failed",
      message_ref: (res && res.messageId) || null, detail: { template: LP_ONBOARDING_EMAIL.key },
    });
    return { outcome: ok ? "sent" : "failed" };
  } catch (err) {
    return { outcome: "error", error: String((err && err.message) || err) };
  }
}
