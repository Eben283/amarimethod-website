import { fetchTodaysAppointments } from "./appointments.js";
import {
  computeMorningTimes,
  dueKinds,
  messageForKind,
  SEND_GRACE_MS,
} from "./schedule.js";
import { parseContactIds, sendGhlSms } from "./ghl-sms.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "../../functions/lib/ops-last-run.js";
import { MORNING_SMS_DEFINITION } from "./config.js";
import { defineMorningSmsWorkflow, renderWorkflowCopy, stepForHandler } from "./workflow-definition.js";

const IDEMPOTENCY_TTL_S = 36 * 60 * 60; // survive past midnight PT

function modeOf(env) {
  const m = String(env.MORNING_SMS_MODE || "shadow").toLowerCase();
  return m === "active" ? "active" : "shadow";
}

function idemKey(dateKey, kind, contactId) {
  return `morning-sms:${dateKey}:${kind}:${contactId}`;
}

function maskId(id) {
  if (!id || id.length < 4) return "***";
  return `…${id.slice(-4)}`;
}

async function finish(env, summary) {
  if (summary.recordNodeId && !summary.executedNodeIds.includes(summary.recordNodeId)) summary.executedNodeIds.push(summary.recordNodeId);
  delete summary.recordNodeId;
  const sendFails = (summary.sends || []).filter((s) => s.result && s.result.success === false).length;
  const status =
    (summary.errors?.length && !(summary.sends?.length)) ||
    (sendFails > 0 && sendFails === summary.sends.length)
      ? "error"
      : "ok";
  await writeOpsLastRun(env, OPS_LAST_RUN_KEYS.morningSms, {
    status,
    mode: summary.mode,
    sendCount: summary.sends?.length || 0,
    skipCount: summary.skipped?.length || 0,
    errorCount: summary.errors?.length || 0,
    errors: (summary.errors || []).slice(0, 5),
    schedule: summary.schedule,
    definitionId: summary.definitionId,
    definitionVersion: summary.definitionVersion,
    executedNodeIds: summary.executedNodeIds,
  });
  return summary;
}

/**
 * @param {object} env
 * @param {{ nowMs?: number, forceKinds?: Array<'prepare'|'meeting'>, dryRun?: boolean }} [opts]
 */
export async function runMorningSms(env, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const definition = defineMorningSmsWorkflow(opts.definition || MORNING_SMS_DEFINITION);
  const timeZone = definition.trigger.timeZone;
  const mode = modeOf(env);
  const recipients = parseContactIds(env.MORNING_SMS_CONTACT_IDS);
  const summary = {
    definitionId: definition.id,
    definitionVersion: definition.definitionVersion,
    executedNodeIds: [stepForHandler(definition, "scheduled_event").id],
    recordNodeId: stepForHandler(definition, "record_run_result").id,
    provider: "ghl",
    mode,
    recipients: recipients.map(maskId),
    schedule: null,
    sends: [],
    skipped: [],
    errors: [],
  };

  if (recipients.length === 0) {
    summary.errors.push("MORNING_SMS_CONTACT_IDS empty or invalid");
    return finish(env, summary);
  }

  let appointments = null;
  try {
    summary.executedNodeIds.push(stepForHandler(definition, "read_todays_appointments").id);
    appointments = await fetchTodaysAppointments(env, nowMs, timeZone);
    summary.executedNodeIds.push(stepForHandler(definition, "identify_last_package_session").id);
  } catch (err) {
    summary.errors.push(`appointment lookup: ${err.message}`);
  }

  const firstAppointmentMs = appointments?.[0]?.startMs ?? null;

  const scheduleStep = stepForHandler(definition, "calculate_due_times");
  summary.executedNodeIds.push(scheduleStep.id);
  const schedule = computeMorningTimes({
    nowMs,
    firstAppointmentMs,
    timeZone,
    defaultFirstMinutes: definition.trigger.defaultFirstMinutes,
    earlyAppointmentLeadMs: definition.trigger.earlyAppointmentLeadMs,
    secondOffsetMs: scheduleStep.afterMs,
  });
  summary.schedule = {
    dateKey: schedule.dateKey,
    reason: schedule.reason,
    firstAt: new Date(schedule.firstAtMs).toISOString(),
    secondAt: new Date(schedule.secondAtMs).toISOString(),
    firstAppointmentAt: firstAppointmentMs ? new Date(firstAppointmentMs).toISOString() : null,
    appointmentCount: appointments?.length ?? null,
  };

  const kinds = opts.forceKinds?.length
    ? opts.forceKinds
    : dueKinds(nowMs, schedule.firstAtMs, schedule.secondAtMs, definition.trigger.sendGraceMs ?? SEND_GRACE_MS);

  if (kinds.length === 0) {
    summary.skipped.push("nothing due in grace window");
    return finish(env, summary);
  }

  const kv = env.PORTAL_KV;
  const dry = Boolean(opts.dryRun) || mode === "shadow";

  for (const kind of kinds) {
    const composeStep = stepForHandler(definition, "compose_agenda");
    if (!summary.executedNodeIds.includes(composeStep.id)) summary.executedNodeIds.push(composeStep.id);
    const sendStep = stepForHandler(definition, "send_due_sms", (step) => step.messageKind === kind);
    const agenda = messageForKind(kind, appointments, timeZone, definition.agendaCopy);
    const body = renderWorkflowCopy(sendStep.copy, { agenda });
    if (!body) continue;
    summary.executedNodeIds.push(sendStep.id);

    for (const contactId of recipients) {
      const key = idemKey(schedule.dateKey, kind, contactId);
      // Dry runs are inspection-only and must show today's current message even
      // after the real daily send has already recorded its idempotency key.
      if (!dry && kv) {
        const seen = await kv.get(key);
        if (seen) {
          summary.skipped.push({ kind, contactId: maskId(contactId), reason: "already-sent" });
          continue;
        }
      }

      if (dry) {
        summary.sends.push({
          kind,
          contactId: maskId(contactId),
          body,
          result: { success: true, shadowed: true },
        });
        continue;
      }

      if (kv) {
        try {
          await kv.put(key, `pending:${nowMs}`, { expirationTtl: IDEMPOTENCY_TTL_S });
        } catch {
          /* non-fatal */
        }
      }

      const result = await sendGhlSms(env, { contactId, message: body });
      summary.sends.push({
        kind,
        contactId: maskId(contactId),
        body,
        result: {
          success: result.success,
          messageId: result.messageId || null,
          status: result.status || null,
          error: result.error || null,
        },
      });

      if (!result.success && kv) {
        try {
          await kv.delete(key);
        } catch {
          /* ignore */
        }
      } else if (result.success && kv) {
        try {
          await kv.put(key, result.messageId || `ok:${nowMs}`, { expirationTtl: IDEMPOTENCY_TTL_S });
        } catch {
          /* ignore */
        }
      }
    }
  }

  return finish(env, summary);
}
