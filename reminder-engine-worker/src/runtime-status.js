import { FLOWS } from "./config.js";
import { INITIAL_IN_PERSON_WORKFLOW } from "./initial-in-person-workflow.js";
import { ensurePublishedWorkflow, workflowVersions, asExecutableWorkflow } from "./workflow-store.js";

function iso(value) {
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function parseDetail(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return { raw: String(value) }; }
}

// This is deliberately served by the executing Worker. Staff must not infer the
// delivery gate from its own copy of the workflow configuration.
export async function runtimeStatus(env, flowKey) {
  const canonical = flowKey === INITIAL_IN_PERSON_WORKFLOW.id
    ? await ensurePublishedWorkflow(env.REMINDER_DB, INITIAL_IN_PERSON_WORKFLOW)
    : null;
  const flow = canonical ? asExecutableWorkflow(canonical) : FLOWS.find((candidate) => candidate.flowKey === flowKey);
  if (!flow) return null;

  const [result, eventResult, receiptHealth] = await Promise.all([env.REMINDER_DB.prepare(
    `SELECT e.enrollment_id, e.contact_id, e.appointment_id, e.definition_version, e.start_at, e.enrolled_at, e.status,
      s.step_index, s.type, s.template, s.due_at, s.status AS step_status
     FROM reminder_enrollments e
     LEFT JOIN reminder_steps s ON s.enrollment_id = e.enrollment_id AND s.status = 'pending'
     WHERE e.flow_key = ?
     ORDER BY e.enrolled_at DESC, s.due_at ASC`,
  ).bind(flowKey).all(), env.REMINDER_DB.prepare(
    `SELECT id, ts, engine, flow_key, definition_version, contact_id, appointment_id,
      step_index, action, outcome, channel, message_ref, detail
     FROM automation_events WHERE engine = 'reminder' AND flow_key = ? ORDER BY ts DESC LIMIT 200`,
  ).bind(flowKey).all(), flowKey === "initial-in-person" && env.PORTAL_KV
    ? env.PORTAL_KV.get("reminder:delivery-receipts:initial-in-person", "json")
    : null]);

  const byEnrollment = new Map();
  for (const row of result.results || []) {
    let enrollment = byEnrollment.get(row.enrollment_id);
    if (!enrollment) {
      enrollment = {
        engine: "reminder",
        key: flowKey,
        enrollmentId: row.enrollment_id,
        contactId: row.contact_id,
        appointmentId: row.appointment_id,
        definitionVersion: row.definition_version,
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
      receiptCoverage: {
        sms: "terminal_status_reconciled",
        email: "provider_acceptance_only",
      },
    },
    definition: canonical,
    receiptHealth,
    versions: canonical ? await workflowVersions(env.REMINDER_DB, flowKey) : [],
    enrollments: [...byEnrollment.values()],
    events: (eventResult.results || []).map((event) => ({
      id: event.id, ts: event.ts, engine: event.engine, flowKey: event.flow_key,
      definitionVersion: event.definition_version, contactId: event.contact_id,
      appointmentId: event.appointment_id, stepIndex: event.step_index, action: event.action,
      outcome: event.outcome, channel: event.channel, messageRef: event.message_ref,
      detail: parseDetail(event.detail),
    })),
  };
}
