import { FLOWS } from "./config.js";

function iso(value) {
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// This is deliberately served by the executing Worker. Staff must not infer the
// delivery gate from its own copy of the workflow configuration.
export async function runtimeStatus(env, flowKey) {
  const flow = FLOWS.find((candidate) => candidate.flowKey === flowKey);
  if (!flow) return null;

  const result = await env.REMINDER_DB.prepare(
    `SELECT e.enrollment_id, e.contact_id, e.appointment_id, e.start_at, e.enrolled_at, e.status,
      s.step_index, s.type, s.template, s.due_at, s.status AS step_status
     FROM reminder_enrollments e
     LEFT JOIN reminder_steps s ON s.enrollment_id = e.enrollment_id AND s.status = 'pending'
     WHERE e.flow_key = ?
     ORDER BY e.enrolled_at DESC, s.due_at ASC`,
  ).bind(flowKey).all();

  const byEnrollment = new Map();
  for (const row of result.results || []) {
    let enrollment = byEnrollment.get(row.enrollment_id);
    if (!enrollment) {
      enrollment = {
        enrollmentId: row.enrollment_id,
        contactId: row.contact_id,
        appointmentId: row.appointment_id,
        startAt: row.start_at,
        enteredAt: row.enrolled_at,
        status: row.status,
        nextStep: null,
      };
      byEnrollment.set(row.enrollment_id, enrollment);
    }
    if (!enrollment.nextStep && row.step_index != null) {
      enrollment.nextStep = {
        stepIndex: row.step_index,
        type: row.type,
        template: row.template,
        dueAt: row.due_at,
        dueAtIso: iso(row.due_at),
      };
    }
  }

  const cutoverEnabled = flowKey === "initial-in-person" && env.INITIAL_IN_PERSON_CUTOVER === "enabled";
  return {
    verifiedAt: new Date().toISOString(),
    flow: {
      key: flow.flowKey,
      name: flow.name,
      definitionVersion: flow.definitionVersion,
      configuredMode: flow.mode,
      delivery: cutoverEnabled ? "active" : "disabled",
    },
    enrollments: [...byEnrollment.values()],
  };
}
