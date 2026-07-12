// Post-Initial Upgrade Offer — the cancellable 3-day timer (GHL exit, purchase cluster gap b).
//
// GHL's version: sessions_completed changes to 1 → guard (no series, not partner-track) →
// wait 3 days → send the upgrade email; five purchase workflows cancel the wait via
// Remove-from-Workflow. In code the wait is a D1 row and the cancels are one idempotent
// function — a stale timer emailing an upgrade pitch after the client already bought is the
// exact failure the cancel exists to prevent.
//
// State lives in the SHARED amari-automation D1 (binding: env.AUTOMATION_DB) so the schedule
// hook (staff-mark-attended.js, a Pages Function) and the hourly sweep (series-reconcile-worker)
// see one table, and every transition lands on the shared automation_events log the dashboard
// reads. Schema: db/upgrade-offer-schema.sql.
//
// Timers are WRITE-ONCE per contact (PK contact_id): sessions_completed crosses 0→1 once in a
// lifetime, so re-scheduling after a cancel would be a bug, not a feature.
// Living Practice standalone purchases deliberately do NOT cancel (eligibility preserved).

export const UPGRADE_OFFER_DELAY_MS = 3 * 86400000; // GHL: "Time Delay — 3 days"

const GUARD_TAGS = ["ambassador-prospect", "affiliate-partner"];

function changesOf(res) {
  return (res && res.meta && res.meta.changes) || 0;
}

/**
 * The GHL entry condition, pure: Series Type empty AND not on the partner track.
 * `seriesType` treats the dropdown default "none" (and blank/null) as empty.
 */
export function shouldScheduleUpgradeOffer({ seriesType, tags }) {
  const st = String(seriesType ?? "").trim().toLowerCase();
  if (st && st !== "none") return false;
  const lower = (tags || []).map((t) => String(t).toLowerCase());
  return !GUARD_TAGS.some((g) => lower.includes(g));
}

/**
 * Schedule the 3-day timer. Write-once: a duplicate sessions_completed→1 event (or a retry)
 * is a no-op. Returns { created }.
 */
export async function scheduleUpgradeOffer(db, contactId, nowMs) {
  const res = await db
    .prepare(
      `INSERT INTO upgrade_offer_timers (contact_id, scheduled_at, due_at, status)
       VALUES (?,?,?,?)
       ON CONFLICT(contact_id) DO NOTHING`,
    )
    .bind(contactId, nowMs, nowMs + UPGRADE_OFFER_DELAY_MS, "pending")
    .run();
  return { created: changesOf(res) === 1 };
}

/**
 * Cancel a pending timer (a series/upgrade purchase landed). Idempotent: cancel of nothing,
 * or of an already-cancelled/fired timer, is a no-op. Returns { cancelled }.
 */
export async function cancelUpgradeOffer(db, contactId) {
  const res = await db
    .prepare(`UPDATE upgrade_offer_timers SET status = 'cancelled' WHERE contact_id = ? AND status = 'pending'`)
    .bind(contactId)
    .run();
  return { cancelled: changesOf(res) === 1 };
}

/**
 * Due queue for the hourly sweep: pending timers whose 3 days have elapsed, oldest first.
 */
export async function loadDueOffers(db, nowMs, limit = 50) {
  const res = await db
    .prepare(
      `SELECT contact_id, scheduled_at, due_at, status
       FROM upgrade_offer_timers
       WHERE status = 'pending' AND due_at <= ?
       ORDER BY due_at ASC
       LIMIT ?`,
    )
    .bind(nowMs, limit)
    .all();
  return res.results || [];
}

/**
 * Record a fired timer's outcome: sent | would_send | suppressed | failed. Any of these takes
 * the row out of the due queue (send-once).
 */
export async function markOffer(db, contactId, status) {
  await db
    .prepare(`UPDATE upgrade_offer_timers SET status = ? WHERE contact_id = ?`)
    .bind(status, contactId)
    .run();
}

/**
 * Append to the shared automation_events log (engine: "purchase") — same table and shape the
 * reminder/nurture engines write, so the dashboard reads one log.
 */
export async function appendAutomationEvent(db, r) {
  await db
    .prepare(
      `INSERT INTO automation_events
         (ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      r.ts, r.engine ?? "purchase", r.flowKey ?? null, r.contactId ?? null, r.appointmentId ?? null,
      r.stepIndex ?? null, r.action ?? null, r.outcome ?? null, r.channel ?? null,
      r.message_ref ?? null, r.detail != null ? JSON.stringify(r.detail) : null,
    )
    .run();
}
