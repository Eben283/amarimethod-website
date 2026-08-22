// Reminder engine — D1 store (the single state spine). Enrollments, their scheduled steps, and the
// append-only automation_events log all live in D1; the due-queue is a query, not a KV structure
// (per DASHBOARD-PLAN). All functions take the D1 binding; none send or compute — pure persistence.

import { resolveDueAt } from "./enroll.js";

function changesOf(res) {
  return (res && res.meta && res.meta.changes) || 0;
}

export function enrollmentId(flowKey, appointmentId) {
  return `${flowKey}:${appointmentId}`;
}

/**
 * Persist an enrollment + its steps. Idempotent on the enrollment PK, so a duplicate booking
 * event does NOT double-enroll (INSERT ... ON CONFLICT DO NOTHING). Steps are only written on a
 * fresh enrollment. Returns { created, enrollmentId }.
 */
export async function saveEnrollment(db, enrollment) {
  const id = enrollmentId(enrollment.flowKey, enrollment.appointmentId);
  const ins = await db
    .prepare(
      `INSERT INTO reminder_enrollments
         (enrollment_id, flow_key, definition_version, appointment_id, contact_id, calendar_id, start_at, start_ms, enrolled_at, status)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(enrollment_id) DO NOTHING`,
    )
    .bind(
      id, enrollment.flowKey, enrollment.definitionVersion ?? 1, enrollment.appointmentId, enrollment.contactId,
      enrollment.calendarId ?? null, enrollment.startAt ?? null, enrollment.startMs ?? null,
      enrollment.enrolledAt, enrollment.status ?? "active",
    )
    .run();

  if (changesOf(ins) !== 1) return { created: false, enrollmentId: id };

  for (const s of enrollment.steps) {
    await db
      .prepare(
        `INSERT INTO reminder_steps (enrollment_id, step_index, at, type, template, due_at, status)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(id, s.stepIndex, s.at, s.type, s.template, s.dueAt, s.status)
      .run();
  }
  return { created: true, enrollmentId: id };
}

/**
 * Move the still-pending timer steps for an existing active appointment. Sent, shadowed, skipped,
 * failed, and cancelled steps are immutable evidence and deliberately stay untouched: a reschedule
 * must never send a second confirmation. Returns false for a duplicate event or non-active record.
 */
export async function retimeEnrollment(db, event, flow, nowMs) {
  const id = enrollmentId(flow.flowKey, event.appointmentId);
  const existing = await db
    .prepare(`SELECT start_at, status FROM reminder_enrollments WHERE enrollment_id = ?`)
    .bind(id)
    .first();
  if (!existing || existing.status !== "active" || existing.start_at === event.startAt) {
    return { rescheduled: false };
  }

  const startMs = Date.parse(event.startAt);
  if (!Number.isFinite(startMs)) return { rescheduled: false };

  const confirmation = await db
    .prepare(`SELECT status FROM reminder_steps WHERE enrollment_id = ? AND template = 'confirmation' LIMIT 1`)
    .bind(id)
    .first();

  for (let stepIndex = 0; stepIndex < flow.steps.length; stepIndex += 1) {
    const definition = flow.steps[stepIndex];
    const dueAt = resolveDueAt(definition.at, startMs, nowMs);
    const status = definition.skipIfPast === true && dueAt < nowMs ? "skipped" : "pending";
    await db
      .prepare(
        `UPDATE reminder_steps
         SET due_at = ?, status = ?
         WHERE enrollment_id = ? AND step_index = ? AND status = 'pending'`,
      )
      .bind(dueAt, status, id, stepIndex)
      .run();
  }
  await db
    .prepare(`UPDATE reminder_enrollments SET start_at = ?, start_ms = ? WHERE enrollment_id = ? AND status = 'active'`)
    .bind(event.startAt, startMs, id)
    .run();
  return { rescheduled: true, previousStartAt: existing.start_at, confirmationSent: confirmation?.status === "sent" };
}

export async function queueRescheduleConfirmation(db, event, flow, nowMs) {
  const id = enrollmentId(flow.flowKey, event.appointmentId);
  const startMs = Date.parse(event.startAt);
  if (!Number.isFinite(startMs)) return { queued: false };
  await db
    .prepare(`UPDATE reminder_steps SET status = 'cancelled'
       WHERE enrollment_id = ? AND template = 'reschedule-confirmation' AND status = 'pending'`)
    .bind(id)
    .run();
  const inserted = await db
    .prepare(`INSERT INTO reminder_steps (enrollment_id, step_index, at, type, template, due_at, status)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(enrollment_id, step_index) DO NOTHING`)
    .bind(id, -startMs, "reschedule", "email", "reschedule-confirmation", nowMs, "pending")
    .run();
  return { queued: changesOf(inserted) === 1, stepIndex: -startMs };
}

/**
 * The due-queue: pending steps whose time has come, on still-active enrollments, oldest first.
 * Returns [{ enrollmentId, enrollment, step }] shaped for processStep.
 */
export async function loadDueSteps(db, nowMs, limit = 100) {
  const res = await db
    .prepare(
      `SELECT s.enrollment_id, s.step_index, s.at, s.type, s.template, s.due_at, s.status AS step_status,
              e.flow_key, e.definition_version, e.appointment_id, e.contact_id, e.calendar_id, e.start_at, e.start_ms
       FROM reminder_steps s
       JOIN reminder_enrollments e ON e.enrollment_id = s.enrollment_id
       WHERE s.status = 'pending' AND s.due_at <= ? AND e.status = 'active'
       ORDER BY s.due_at ASC
       LIMIT ?`,
    )
    .bind(nowMs, limit)
    .all();

  return (res.results || []).map((r) => ({
    enrollmentId: r.enrollment_id,
    enrollment: {
      flowKey: r.flow_key,
      definitionVersion: r.definition_version,
      appointmentId: r.appointment_id,
      contactId: r.contact_id,
      calendarId: r.calendar_id,
      startAt: r.start_at,
      startMs: r.start_ms,
    },
    step: {
      stepIndex: r.step_index,
      at: r.at,
      type: r.type,
      template: r.template,
      dueAt: r.due_at,
      status: r.step_status,
    },
  }));
}

export async function markStep(db, id, stepIndex, status) {
  await db
    .prepare(`UPDATE reminder_steps SET status = ? WHERE enrollment_id = ? AND step_index = ?`)
    .bind(status, id, stepIndex)
    .run();
}

export async function appendEvent(db, r) {
  await db
    .prepare(
      `INSERT INTO automation_events
         (ts, engine, flow_key, definition_version, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      r.ts, r.engine ?? "reminder", r.flowKey ?? null, r.definitionVersion ?? null,
      r.contactId ?? null, r.appointmentId ?? null,
      r.stepIndex ?? null, r.action ?? null, r.outcome ?? null, r.channel ?? null,
      r.message_ref ?? null, r.detail != null ? JSON.stringify(r.detail) : null,
    )
    .run();
}

export async function loadDeliveryReceiptCandidates(db, cutoffMs, limit = 50, page = 0, flowKey = "initial-in-person") {
  const countResult = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM automation_events sent
     WHERE sent.engine = 'reminder'
       AND sent.flow_key = ?
       AND sent.action = 'send'
       AND sent.outcome = 'sent'
       AND sent.channel = 'sms'
       AND sent.message_ref IS NOT NULL
       AND sent.ts >= ?
       AND NOT EXISTS (
         SELECT 1 FROM automation_events receipt
         WHERE receipt.action = 'delivery_status'
           AND receipt.message_ref = sent.message_ref
           AND receipt.outcome IN ('delivered', 'failed', 'bounced')
       )`,
  ).bind(flowKey, cutoffMs).all();
  const count = Number(countResult.results?.[0]?.count || 0);
  if (!count) return [];
  const offset = (Math.max(0, page) * limit) % count;
  const result = await db.prepare(
    `SELECT sent.id, sent.ts, sent.engine, sent.flow_key, sent.definition_version,
            sent.contact_id, sent.appointment_id, sent.step_index, sent.action,
            sent.outcome, sent.channel, sent.message_ref, sent.detail
     FROM automation_events sent
     WHERE sent.engine = 'reminder'
       AND sent.flow_key = ?
       AND sent.action = 'send'
       AND sent.outcome = 'sent'
       AND sent.channel = 'sms'
       AND sent.message_ref IS NOT NULL
       AND sent.ts >= ?
       AND NOT EXISTS (
         SELECT 1 FROM automation_events receipt
         WHERE receipt.action = 'delivery_status'
           AND receipt.message_ref = sent.message_ref
           AND receipt.outcome IN ('delivered', 'failed', 'bounced')
       )
     ORDER BY sent.ts ASC
     LIMIT ? OFFSET ?`,
  ).bind(flowKey, cutoffMs, limit, offset).all();
  return result.results || [];
}

export async function appendDeliveryReceiptEvent(db, event) {
  const result = await db.prepare(
    `INSERT INTO automation_events
       (ts, engine, flow_key, definition_version, contact_id, appointment_id,
        step_index, action, outcome, channel, message_ref, detail)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?
     WHERE NOT EXISTS (
       SELECT 1 FROM automation_events
       WHERE action = 'delivery_status'
         AND message_ref = ?
         AND outcome IN ('delivered', 'failed', 'bounced')
     )`,
  ).bind(
    event.ts, event.engine ?? "reminder", event.flowKey ?? null,
    event.definitionVersion ?? null, event.contactId ?? null,
    event.appointmentId ?? null, event.stepIndex ?? null,
    event.action, event.outcome, event.channel, event.message_ref,
    event.detail != null ? JSON.stringify(event.detail) : null,
    event.message_ref,
  ).run();
  return changesOf(result) === 1;
}

/**
 * Cancel an enrollment: mark it cancelled and cancel every still-pending step (sent/would_send
 * stay as history). Returns { cancelledSteps }.
 */
export async function cancelEnrollment(db, id) {
  const upd = await db
    .prepare(`UPDATE reminder_steps SET status = 'cancelled' WHERE enrollment_id = ? AND status = 'pending'`)
    .bind(id)
    .run();
  await db
    .prepare(`UPDATE reminder_enrollments SET status = 'cancelled' WHERE enrollment_id = ?`)
    .bind(id)
    .run();
  return { cancelledSteps: changesOf(upd) };
}

/**
 * Close every active enrollment of one flow for a contact. This is intentionally contact-scoped:
 * a rebooking may have a new appointment id, while a no-show follow-up belongs to the person.
 * It preserves completed step evidence and only cancels still-pending work.
 */
export async function exitEnrollmentsForContact(db, flowKey, contactId) {
  const stepUpdate = await db
    .prepare(
      `UPDATE reminder_steps SET status = 'cancelled'
       WHERE status = 'pending' AND enrollment_id IN (
         SELECT enrollment_id FROM reminder_enrollments
         WHERE flow_key = ? AND contact_id = ? AND status = 'active'
       )`,
    )
    .bind(flowKey, contactId)
    .run();
  const enrollmentUpdate = await db
    .prepare(`UPDATE reminder_enrollments SET status = 'cancelled' WHERE flow_key = ? AND contact_id = ? AND status = 'active'`)
    .bind(flowKey, contactId)
    .run();
  return { cancelledSteps: changesOf(stepUpdate), exitedEnrollments: changesOf(enrollmentUpdate) };
}
