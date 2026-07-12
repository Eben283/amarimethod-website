// Post-Initial Upgrade Offer — the hourly due sweep (GHL exit Unit C gap b, fire side).
// Schedule/cancel live in functions/lib/upgrade-offer.js on the shared amari-automation D1;
// this module fires (or shadow-logs) timers whose 3 days have elapsed, riding this worker's
// existing hourly cron.
//
// The RE-CHECK is the design's safety net: the 3-day window is exactly where a purchase or a
// partner promotion can land, so the guard (series_type still empty, tags still clean) is
// re-evaluated against a FRESH contact read at fire time — a missed cancel becomes a
// suppressed send, never an upgrade pitch after the client already bought.
//
// Shadow (the default, matching the engines): a due timer logs would_send and NEVER sends.
// Active-mode send is a cutover brick (deps.send default throws loudly).

import {
  loadDueOffers, markOffer, appendAutomationEvent, shouldScheduleUpgradeOffer,
} from "../../functions/lib/upgrade-offer.js";
import { getContact } from "./ghl.js";
import { FIELD_IDS, readField } from "./reconcile.js";

// Flip to "active" only at the purchase-cluster cutover (one release, all sources together).
const MODE = "shadow";

// Verbatim 2026-06-17 live post-scrub copy (twin: post-initial-upgrade-offer.yaml). Never
// migrate the stale 2026-04-01 memory-doc version; the removed "short window" urgency line
// stays dead. RESOLVE FIRST before active mode: current {{custom_values.*}} price values
// (resolve to config constants at cutover).
export const UPGRADE_OFFER_EMAIL = Object.freeze({
  key: "upgrade-offer-email",
  from: Object.freeze({ name: "Garrett", email: "garrett@amarimethod.com" }),
  subject: "Ready to go deeper",
  preheader: "One thing I wanted to mention after our session.",
  body: `Hi {{contact.first_name}},

It was great working with you. I hope you're already feeling the difference.

I'll be honest, I think continuing the work is what gets you where you want to go. One session starts it, but a series is where the change holds. So I want to make it easy to keep going. You can apply your {{custom_values.initial_session_price}} initial session toward either one.

4-Session Series, {{custom_values.4session_series_price}}
Your initial session applied, plus four sessions to build real momentum.
Upgrade to 4 sessions → https://link.amarimethod.com/payment-link/699873a81a8400115e0381db

8-Session Series, {{custom_values.8session_series_price}}
Your initial session applied, plus eight sessions and access to the Living Practice program.
Upgrade to 8 sessions → https://link.amarimethod.com/payment-link/699873e31a840007c0038223

Either way, your portal has everything you need to book and track your progress.

Let me know if you have any questions.

Garrett`,
});

/**
 * Fire every due upgrade-offer timer. Deps injectable for tests; defaults use this worker's
 * GHL client. Returns per-outcome counts. A contact-read failure leaves that timer pending
 * (the next hourly run retries) and never stops the sweep.
 */
export async function sweepUpgradeOffers(env, nowMs, deps = {}) {
  const db = env.AUTOMATION_DB;
  if (!db) return { skipped: "no-binding" };

  const d = {
    getContact: (contactId) => getContact(env, contactId),
    send: async () => { throw new Error("active-mode upgrade-offer send not built yet"); },
    ...deps,
  };

  const due = await loadDueOffers(db, nowMs);
  const counts = { would_send: 0, sent: 0, suppressed: 0, failed: 0, errors: 0 };

  for (const timer of due) {
    const contactId = timer.contact_id;
    let contact;
    try {
      contact = await d.getContact(contactId);
    } catch (err) {
      counts.errors += 1;
      await appendAutomationEvent(db, {
        ts: nowMs, flowKey: "upgrade-offer", contactId,
        action: "send", outcome: "error",
        detail: { error: String((err && err.message) || err), retry: "next-sweep" },
      });
      continue; // stays pending — retried next hour
    }

    const stillEligible = shouldScheduleUpgradeOffer({
      seriesType: readField(contact, FIELD_IDS.series_type),
      tags: contact.tags || [],
    });
    if (!stillEligible) {
      await markOffer(db, contactId, "suppressed");
      await appendAutomationEvent(db, {
        ts: nowMs, flowKey: "upgrade-offer", contactId,
        action: "send", outcome: "suppressed", detail: { reason: "guard-failed-at-fire-time" },
      });
      counts.suppressed += 1;
      continue;
    }

    if (MODE !== "active") {
      await markOffer(db, contactId, "would_send");
      await appendAutomationEvent(db, {
        ts: nowMs, flowKey: "upgrade-offer", contactId, channel: "email",
        action: "would_send", outcome: "would_send", detail: { template: UPGRADE_OFFER_EMAIL.key },
      });
      counts.would_send += 1;
      continue;
    }

    let ok = false;
    try {
      const res = await d.send(contact, UPGRADE_OFFER_EMAIL);
      ok = !!(res && res.success);
    } catch {
      ok = false;
    }
    await markOffer(db, contactId, ok ? "sent" : "failed");
    await appendAutomationEvent(db, {
      ts: nowMs, flowKey: "upgrade-offer", contactId, channel: "email",
      action: "send", outcome: ok ? "sent" : "failed", detail: { template: UPGRADE_OFFER_EMAIL.key },
    });
    counts[ok ? "sent" : "failed"] += 1;
  }
  return counts;
}
