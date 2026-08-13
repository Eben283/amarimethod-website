import {
  ASSESSMENT_PAID_BOOKING_WORKFLOW,
  ASSESSMENT_PAID_BOOKING_WORKFLOW_ID,
  defineAssessmentPaidBookingWorkflow,
} from "./assessment-paid-booking-workflow.js";

const REMINDER_ENGINE_URL = "https://reminder-engine.eben-fa2.workers.dev";

// Pages Functions do not get a second mutable booking settings object. In
// production they ask the Worker that owns workflow_versions for its published
// document. The bundled document exists only for local tests/first deployment
// before the Worker has been called once.
export async function currentAssessmentPaidBookingWorkflow(context) {
  if (context?.assessmentWorkflow) return defineAssessmentPaidBookingWorkflow(context.assessmentWorkflow);
  const secret = context?.env?.WORKER_AUTH_SECRET;
  if (!secret) return ASSESSMENT_PAID_BOOKING_WORKFLOW;
  const response = await fetch(`${REMINDER_ENGINE_URL}/runtime-status?flow=${encodeURIComponent(ASSESSMENT_PAID_BOOKING_WORKFLOW_ID)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error(`Assessment workflow runtime is unavailable (${response.status})`);
  const body = await response.json();
  return defineAssessmentPaidBookingWorkflow(body?.runtime?.definition);
}
