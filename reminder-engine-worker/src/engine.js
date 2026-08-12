// Reminder engine — orchestration. Ties the pure enroll logic, the D1 store, and the shadow-aware
// sweep together. Two entry points:
//   handleEvent(env, event, nowMs) — an appointment event arrived (from the webhook dispatch seam):
//       enroll into any matching flow, and/or cancel on a cancelOn event.
//   runSweep(env, nowMs)           — the cron: fire (or shadow-log) every due step.

import { FLOWS } from "./config.js";
import { enroll } from "./enroll.js";
import { processStep } from "./sweep.js";
import { resolvePipelineMoves } from "./pipeline.js";
import { saveEnrollment, retimeEnrollment, loadDueSteps, markStep, appendEvent, cancelEnrollment, exitEnrollmentsForContact, enrollmentId } from "./store.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../../functions/lib/ops-last-run.js";
import { assessmentCutoverEligibility, assessmentTestEligibility, renderAssessmentConfirmation } from "./assessment-test-delivery.js";
import { sendOwnedEmail } from "./gmail-test-send.js";
import { deliverInitialInPersonStep, initialInPersonCutoverEligibility } from "./initial-in-person-cutover.js";
import { INITIAL_IN_PERSON_WORKFLOW } from "./initial-in-person-workflow.js";
import { deliverInitialVirtualStep, initialVirtualCutoverEligibility } from "./initial-virtual-cutover.js";
import { INITIAL_VIRTUAL_WORKFLOW } from "./initial-virtual-workflow.js";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";
import { ensurePublishedWorkflow, publishedWorkflow, workflowVersion, asExecutableWorkflow } from "./workflow-store.js";

async function executionFlows(env) {
  // The in-person version predates the separately gated release lane. Virtual
  // deliberately does not seed here: an ordinary deployment must not publish,
  // enroll, shadow, backfill, or otherwise change its live behavior.
  const documents = [
    await ensurePublishedWorkflow(env.REMINDER_DB, INITIAL_IN_PERSON_WORKFLOW),
    await publishedWorkflow(env.REMINDER_DB, INITIAL_VIRTUAL_WORKFLOW.id),
    await publishedWorkflow(env.REMINDER_DB, FOLLOW_UP_WORKFLOW.id),
  ].filter(Boolean);
  const canonical = Object.fromEntries(documents.map((document) => [document.id, asExecutableWorkflow(document)]));
  const canonicalOnly = new Set([INITIAL_IN_PERSON_WORKFLOW.id, INITIAL_VIRTUAL_WORKFLOW.id, FOLLOW_UP_WORKFLOW.id]);
  return FLOWS
    .filter((flow) => !canonicalOnly.has(flow.flowKey) || canonical[flow.flowKey])
    .map((flow) => canonical[flow.flowKey] || flow);
}

/**
 * React to an appointment event: enroll into flows whose enrollOn matches, cancel flows whose
 * cancelOn matches. Idempotent (saveEnrollment de-dupes a repeated booking). Returns { actions }
 * for the dispatch seam to echo.
 */
export async function handleEvent(env, event, nowMs) {
  const db = env.REMINDER_DB;
  const actions = [];
  if (!event || event.recognized !== true) return { actions };

  const flows = (await executionFlows(env)).filter((flow) => flow.calendarIds.includes(event.calendarId));
  for (const flow of flows) {
    if (flow.enrollOn.statuses.includes(event.type)) {
      const enrollment = enroll(event, flow, nowMs);
      if (enrollment) {
        const { created } = await saveEnrollment(db, enrollment);
        if (created) {
          await appendEvent(db, {
            ts: nowMs, engine: "reminder", flowKey: flow.flowKey, contactId: event.contactId,
            definitionVersion: flow.definitionVersion,
            appointmentId: event.appointmentId, action: "enrolled", outcome: "enrolled",
            detail: { calendarId: event.calendarId, steps: enrollment.steps.length, mode: flow.mode },
          });
        }
        if (!created) {
          const retimed = await retimeEnrollment(db, event, flow, nowMs);
          if (retimed.rescheduled) {
            await appendEvent(db, {
              ts: nowMs, engine: "reminder", flowKey: flow.flowKey, contactId: event.contactId,
              definitionVersion: flow.definitionVersion,
              appointmentId: event.appointmentId, action: "rescheduled", outcome: "rescheduled",
              detail: { previousStartAt: retimed.previousStartAt, startAt: event.startAt },
            });
          }
          actions.push({ engine: "reminder", action: retimed.rescheduled ? "reschedule" : "enroll-noop", detail: { flowKey: flow.flowKey } });
        } else {
          actions.push({ engine: "reminder", action: "enroll", detail: { flowKey: flow.flowKey } });
        }
      }
    }

    if (flow.cancelOn.includes(event.type)) {
      const id = enrollmentId(flow.flowKey, event.appointmentId);
      const { cancelledSteps } = await cancelEnrollment(db, id);
      if (cancelledSteps > 0) {
        await appendEvent(db, {
          ts: nowMs, engine: "reminder", flowKey: flow.flowKey, contactId: event.contactId,
          definitionVersion: flow.definitionVersion,
          appointmentId: event.appointmentId, action: "cancelled", outcome: "cancelled",
          detail: { cancelledSteps },
        });
      }
      actions.push({ engine: "reminder", action: "cancel", detail: { flowKey: flow.flowKey, cancelledSteps } });
    }

    if (flow.exitOn && flow.exitOn.includes(event.type) && event.contactId) {
      const { cancelledSteps, exitedEnrollments } = await exitEnrollmentsForContact(db, flow.flowKey, event.contactId);
      if (exitedEnrollments > 0) {
        await appendEvent(db, {
          ts: nowMs, engine: "reminder", flowKey: flow.flowKey, contactId: event.contactId,
          definitionVersion: flow.definitionVersion, appointmentId: event.appointmentId,
          action: "exited", outcome: "exited",
          detail: { reason: "confirmed_rebooking", cancelledSteps, exitedEnrollments },
        });
        actions.push({ engine: "reminder", action: "exit", detail: { flowKey: flow.flowKey, cancelledSteps, exitedEnrollments } });
      }
    }
  }

  // Pipeline moves (stateless consumer). Shadow-safe: log would_move, never touch GHL. Active-mode
  // GHL create_or_update_opportunity is a later brick (needs stage UUIDs — see pipeline.js).
  for (const move of resolvePipelineMoves(event)) {
    if (move.mode !== "active") {
      await appendEvent(db, {
        ts: nowMs, engine: "pipeline", flowKey: null, contactId: event.contactId,
        appointmentId: event.appointmentId, action: "move", outcome: "would_move",
        detail: { pipeline: move.pipeline, stage: move.stage, markLost: move.markLost },
      });
      actions.push({ engine: "pipeline", action: "would_move", detail: { pipeline: move.pipeline, stage: move.stage } });
    } else {
      actions.push({ engine: "pipeline", action: "move", detail: { pipeline: move.pipeline, stage: move.stage } });
    }
  }

  return { actions };
}

/**
 * Cron sweep: process every due pending step. Shadow flows log would_send and never send;
 * active flows render + send via the shared GHL adapter. Returns per-outcome counts.
 */
export async function runSweep(env, nowMs, limit = 100) {
  const db = env.REMINDER_DB;
  const due = await loadDueSteps(db, nowMs, limit);
  const flowByKey = Object.fromEntries((await executionFlows(env)).map((f) => [f.flowKey, f]));

  const deps = {
    logEvent: (r) => appendEvent(db, r),
    markStep: (enr, idx, status) => markStep(db, enrollmentId(enr.flowKey, enr.appointmentId), idx, status),
    exitFlow: async (target, contactId) => {
      if (!target || !contactId) return null;
      return exitEnrollmentsForContact(db, target, contactId);
    },
    // active-mode only; copy templates are a later brick, so an active flow without templates
    // fails loudly rather than sending a blank message. Shadow flows never reach this.
    renderMessage: async () => { throw new Error("active-mode templates not built yet"); },
    send: (msg) => sendConversationMessage({ env }, msg),
    controlledDelivery: async (flow, step, enrollment) => {
      const gate = assessmentTestEligibility(env, flow, step, enrollment);
      if (gate.eligible) {
        const message = await renderAssessmentConfirmation(env, enrollment);
        return { handled: true, kind: "test", recipient: gate.recipient, result: await sendOwnedEmail(env, { to: gate.recipient, ...message }) };
      }
      const fullCutover = initialInPersonCutoverEligibility(env, flow, step, enrollment);
      if (fullCutover.eligible) {
        const result = await deliverInitialInPersonStep(env, step, enrollment, {}, flow.workflowDocument);
        return { handled: true, kind: "cutover", recipient: result.recipient || null, result };
      }
      const virtualCutover = initialVirtualCutoverEligibility(env, flow, step, enrollment);
      if (virtualCutover.eligible) {
        const result = await deliverInitialVirtualStep(env, step, enrollment, {}, flow.workflowDocument);
        return { handled: true, kind: "cutover", recipient: result.recipient || null, result };
      }
      const cutover = assessmentCutoverEligibility(env, flow, step, enrollment);
      if (!cutover.eligible) return null;
      const message = await renderAssessmentConfirmation(env, enrollment);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.recipient)) {
        return { handled: true, recipient: null, result: { success: false, error: "Assessment contact email is unavailable" } };
      }
      return { handled: true, kind: "cutover", recipient: message.recipient, result: await sendOwnedEmail(env, { to: message.recipient, ...message }) };
    },
  };

  const counts = { would_send: 0, would_execute: 0, executed: 0, sent: 0, failed: 0, skip: 0 };
  for (const item of due) {
    let flow = flowByKey[item.enrollment.flowKey];
    if ([INITIAL_IN_PERSON_WORKFLOW.id, INITIAL_VIRTUAL_WORKFLOW.id].includes(flow?.flowKey) && item.enrollment.definitionVersion !== flow.definitionVersion) {
      const pinned = await workflowVersion(db, flow.flowKey, item.enrollment.definitionVersion);
      if (pinned) flow = asExecutableWorkflow(pinned);
    }
    if (!flow) continue;
    const r = await processStep({ ...item, flow }, deps, nowMs);
    counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  }

  // Ops board signal — sweep health, not "did we send marketing".
  try {
    const failed = counts.failed || 0;
    await writeOpsLastRun(env, OPS_LAST_RUN_KEYS.reminder, {
      status: failed > 0 && (counts.sent || 0) + (counts.would_send || 0) === 0 ? "error" : "ok",
      due: due.length,
      ...counts,
      startedAt: new Date(nowMs).toISOString(),
    });
  } catch {
    /* never break the sweep for board writes */
  }

  return counts;
}
