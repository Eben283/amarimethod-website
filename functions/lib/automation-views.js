// Automation dashboard — read layer over the shared amari-automation D1 spine (DASHBOARD-PLAN
// v1: per-contact timeline + failures table). Pure queries, no writes, no GHL calls; the staff
// endpoint (functions/api/staff-automations.js) is a thin auth wrapper around these.
//
// Scale note (from the plan): a few hundred rows total — plain per-table queries, no rollups.

function parseDetail(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return { raw }; }
}

function normalizeEvent(r) {
  return {
    ts: r.ts,
    engine: r.engine,
    flowKey: r.flow_key,
    contactId: r.contact_id,
    appointmentId: r.appointment_id,
    stepIndex: r.step_index,
    action: r.action,
    outcome: r.outcome,
    channel: r.channel,
    messageRef: r.message_ref,
    detail: parseDetail(r.detail),
  };
}

function nextPendingStep(steps) {
  const pending = steps.filter((s) => s.status === "pending").sort((a, b) => a.due_at - b.due_at);
  if (!pending.length) return null;
  const s = pending[0];
  return { stepIndex: s.step_index, template: s.template, dueAt: s.due_at, type: s.type ?? s.kind ?? null };
}

function normalizeStep(s) {
  return {
    stepIndex: s.step_index,
    at: s.at ?? s.after ?? null,
    type: s.type ?? s.kind ?? null,
    template: s.template,
    dueAt: s.due_at,
    status: s.status,
  };
}

async function rows(db, sql, ...binds) {
  const res = await db.prepare(sql).bind(...binds).all();
  return res.results || [];
}

/**
 * Everything the automation system knows about one contact: enrollments across both engines
 * (normalized, with the next pending step resolved), purchase-cluster state, and the
 * reverse-chron event history. An unknown contact yields an empty view, never an error.
 */
export async function contactAutomationView(db, contactId, eventLimit = 200) {
  const [
    remEnr, remSteps, nurEnr, nurSteps, timers, confirmations, lpSends, events,
  ] = await Promise.all([
    rows(db, `SELECT * FROM reminder_enrollments WHERE contact_id = ?`, contactId),
    rows(db, `SELECT s.* FROM reminder_steps s
       JOIN reminder_enrollments e ON e.enrollment_id = s.enrollment_id
       WHERE e.contact_id = ?`, contactId),
    rows(db, `SELECT * FROM nurture_enrollments WHERE contact_id = ?`, contactId),
    rows(db, `SELECT s.* FROM nurture_steps s
       JOIN nurture_enrollments e ON e.enrollment_id = s.enrollment_id
       WHERE e.contact_id = ?`, contactId),
    rows(db, `SELECT * FROM upgrade_offer_timers WHERE contact_id = ?`, contactId),
    rows(db, `SELECT * FROM purchase_confirmations WHERE contact_id = ?`, contactId),
    rows(db, `SELECT * FROM lp_onboarding_sends WHERE contact_id = ?`, contactId),
    rows(db, `SELECT * FROM automation_events WHERE contact_id = ? ORDER BY ts DESC LIMIT ?`, contactId, eventLimit),
  ]);

  const enrollments = [
    ...remEnr.map((e) => {
      const steps = remSteps.filter((s) => s.enrollment_id === e.enrollment_id).map(normalizeStep);
      return {
        engine: "reminder",
        key: e.flow_key,
        enrollmentId: e.enrollment_id,
        appointmentId: e.appointment_id,
        startAt: e.start_at,
        enteredAt: e.enrolled_at,
        status: e.status,
        steps,
        nextStep: e.status === "active" ? nextPendingStep(remSteps.filter((s) => s.enrollment_id === e.enrollment_id)) : null,
      };
    }),
    ...nurEnr.map((e) => {
      const raw = nurSteps.filter((s) => s.enrollment_id === e.enrollment_id);
      return {
        engine: "nurture",
        key: e.sequence_id,
        enrollmentId: e.enrollment_id,
        enteredAt: e.entered_at,
        status: e.status,
        guardUnchecked: !!e.guard_unchecked,
        steps: raw.map(normalizeStep),
        nextStep: e.status === "active" ? nextPendingStep(raw) : null,
      };
    }),
  ];

  return {
    contactId,
    enrollments,
    upgradeOffer: timers[0] || null,
    confirmations,
    lpOnboarding: lpSends[0] || null,
    events: events.map(normalizeEvent),
  };
}

/**
 * The activity feed: EVERY automation event since the cutoff, all contacts, newest first —
 * "what is happening today / yesterday" (Eben's v1 ask, 2026-07-12). This is the shadow-watch
 * instrument: during the beside-GHL period the feed is the log you compare against what GHL
 * actually sent.
 */
export async function activityView(db, { sinceMs = 0, limit = 500 } = {}) {
  const res = await rows(
    db,
    `SELECT * FROM automation_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?`,
    sinceMs, limit,
  );
  return res.map(normalizeEvent);
}

/**
 * The failures table: every failed/bounced/error event since the cutoff, newest first.
 */
export async function failuresView(db, { sinceMs = 0, limit = 100 } = {}) {
  const res = await rows(
    db,
    `SELECT * FROM automation_events WHERE outcome IN ('failed','bounced','error') AND ts >= ?
     ORDER BY ts DESC LIMIT ?`,
    sinceMs, limit,
  );
  return res.map(normalizeEvent);
}
