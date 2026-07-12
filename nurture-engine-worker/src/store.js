// Nurture engine — D1 store (the single state spine, same contract as the reminder engine's).
// Enrollments, their scheduled steps, and the shared append-only automation_events log all live
// in D1; the due-queue is a query, not a KV structure (per DASHBOARD-PLAN). All functions take
// the D1 binding; none send or compute — pure persistence.

function changesOf(res) {
  return (res && res.meta && res.meta.changes) || 0;
}

// One enrollment per (sequence, contact) — nurture identity is the CONTACT, not an appointment.
// Re-enrollment after an exit is deliberately not supported (matches GHL no-re-entry behavior).
export function enrollmentId(sequenceId, contactId) {
  return `${sequenceId}:${contactId}`;
}

/**
 * Persist an enrollment + its steps. Idempotent on the enrollment PK, so a duplicate entry
 * event (e.g. a re-fired quiz.submitted) does NOT double-enroll. Steps are only written on a
 * fresh enrollment. Returns { created, enrollmentId }.
 */
export async function saveEnrollment(db, enrollment) {
  const id = enrollmentId(enrollment.sequenceId, enrollment.contactId);
  const ins = await db
    .prepare(
      `INSERT INTO nurture_enrollments
         (enrollment_id, sequence_id, contact_id, entered_at, status, guard_unchecked)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(enrollment_id) DO NOTHING`,
    )
    .bind(
      id, enrollment.sequenceId, enrollment.contactId, enrollment.enteredAt,
      enrollment.status ?? "active", enrollment.guardUnchecked ? 1 : 0,
    )
    .run();

  if (changesOf(ins) !== 1) return { created: false, enrollmentId: id };

  for (const s of enrollment.steps) {
    await db
      .prepare(
        `INSERT INTO nurture_steps (enrollment_id, step_index, after, kind, template, due_at, status)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(id, s.stepIndex, s.after, s.kind, s.template, s.dueAt, s.status)
      .run();
  }
  return { created: true, enrollmentId: id };
}

/**
 * The due-queue: pending steps whose time has come, on still-active enrollments, oldest first.
 * Returns [{ enrollmentId, enrollment, step }] shaped for processStep.
 */
export async function loadDueSteps(db, nowMs, limit = 100) {
  const res = await db
    .prepare(
      `SELECT s.enrollment_id, s.step_index, s.after, s.kind, s.template, s.due_at, s.status AS step_status,
              e.sequence_id, e.contact_id, e.entered_at
       FROM nurture_steps s
       JOIN nurture_enrollments e ON e.enrollment_id = s.enrollment_id
       WHERE s.status = 'pending' AND s.due_at <= ? AND e.status = 'active'
       ORDER BY s.due_at ASC
       LIMIT ?`,
    )
    .bind(nowMs, limit)
    .all();

  return (res.results || []).map((r) => ({
    enrollmentId: r.enrollment_id,
    enrollment: {
      sequenceId: r.sequence_id,
      contactId: r.contact_id,
      enteredAt: r.entered_at,
    },
    step: {
      stepIndex: r.step_index,
      after: r.after,
      kind: r.kind,
      template: r.template,
      dueAt: r.due_at,
      status: r.step_status,
    },
  }));
}

/**
 * A contact's active enrollments — what the exit pass scans when an exit event arrives.
 */
export async function loadActiveEnrollments(db, contactId) {
  const res = await db
    .prepare(
      `SELECT enrollment_id, sequence_id, contact_id
       FROM nurture_enrollments WHERE contact_id = ? AND status = 'active'`,
    )
    .bind(contactId)
    .all();
  return (res.results || []).map((r) => ({
    enrollmentId: r.enrollment_id,
    sequenceId: r.sequence_id,
    contactId: r.contact_id,
  }));
}

export async function markStep(db, id, stepIndex, status) {
  await db
    .prepare(`UPDATE nurture_steps SET status = ? WHERE enrollment_id = ? AND step_index = ?`)
    .bind(status, id, stepIndex)
    .run();
}

export async function appendEvent(db, r) {
  await db
    .prepare(
      `INSERT INTO automation_events
         (ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      r.ts, r.engine ?? "nurture", r.flowKey ?? null, r.contactId ?? null, r.appointmentId ?? null,
      r.stepIndex ?? null, r.action ?? null, r.outcome ?? null, r.channel ?? null,
      r.message_ref ?? null, r.detail != null ? JSON.stringify(r.detail) : null,
    )
    .run();
}

/**
 * Exit an enrollment (a conversion event matched): mark every still-pending step exited and
 * close the enrollment. History statuses (sent/would_send/imported) stay. Exits beat pending
 * sends — an exited enrollment's steps never load into the due-queue again.
 * No-op when the contact has no active enrollment. Returns { exitedSteps, closed } — `closed`
 * is true when an active enrollment was transitioned (even if no steps were still pending).
 */
export async function exitEnrollment(db, id) {
  const upd = await db
    .prepare(`UPDATE nurture_steps SET status = 'exited' WHERE enrollment_id = ? AND status = 'pending'`)
    .bind(id)
    .run();
  const enr = await db
    .prepare(`UPDATE nurture_enrollments SET status = 'exited' WHERE enrollment_id = ? AND status = 'active'`)
    .bind(id)
    .run();
  return { exitedSteps: changesOf(upd), closed: changesOf(enr) === 1 };
}
