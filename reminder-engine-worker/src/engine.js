// Reminder engine — orchestration. Ties the pure enroll logic, the D1 store, and the shadow-aware
// sweep together. Two entry points:
//   handleEvent(env, event, nowMs) — an appointment event arrived (from the webhook dispatch seam):
//       enroll into any matching flow, and/or cancel on a cancelOn event.
//   runSweep(env, nowMs)           — the cron: fire (or shadow-log) every due step.

import { FLOWS, flowsForCalendar } from "./config.js";
import { enroll } from "./enroll.js";
import { processStep } from "./sweep.js";
import { resolvePipelineMoves } from "./pipeline.js";
import { saveEnrollment, retimeEnrollment, loadDueSteps, markStep, appendEvent, cancelEnrollment, exitEnrollmentsForContact, enrollmentId } from "./store.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../../functions/lib/ops-last-run.js";
import { assessmentTestEligibility, renderAssessmentConfirmation } from "./assessment-test-delivery.js";
import { sendAssessmentTestEmail } from "./gmail-test-send.js";

/**
 * React to an appointment event: enroll into flows whose enrollOn matches, cancel flows whose
 * cancelOn matches. Idempotent (saveEnrollment de-dupes a repeated booking). Returns { actions }
 * for the dispatch seam to echo.
 */
export async function handleEvent(env, event, nowMs) {
  const db = env.REMINDER_DB;
  const actions = [];
  if (!event || event.recognized !== true) return { actions };

  for (const flow of flowsForCalendar(event.calendarId)) {
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
  const flowByKey = Object.fromEntries(FLOWS.map((f) => [f.flowKey, f]));

  const deps = {
    logEvent: (r) => appendEvent(db, r),
    markStep: (enr, idx, status) => markStep(db, enrollmentId(enr.flowKey, enr.appointmentId), idx, status),
    // active-mode only; copy templates are a later brick, so an active flow without templates
    // fails loudly rather than sending a blank message. Shadow flows never reach this.
    renderMessage: async () => { throw new Error("active-mode templates not built yet"); },
    send: (msg) => sendConversationMessage({ env }, msg),
    testDelivery: async (flow, step, enrollment) => {
      const gate = assessmentTestEligibility(env, flow, step, enrollment);
      if (!gate.eligible) return null;
      const message = await renderAssessmentConfirmation(env, enrollment);
      return { handled: true, recipient: gate.recipient, result: await sendAssessmentTestEmail(env, { to: gate.recipient, ...message }) };
    },
  };

  const counts = { would_send: 0, sent: 0, failed: 0, skip: 0 };
  for (const item of due) {
    const flow = flowByKey[item.enrollment.flowKey];
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
