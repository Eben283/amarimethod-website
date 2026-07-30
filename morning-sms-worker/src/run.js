import { fetchFirstAppointmentMs } from "./appointments.js";
import {
  computeMorningTimes,
  dueKinds,
  messageForKind,
  SEND_GRACE_MS,
} from "./schedule.js";
import { parseRecipients, sendTwilioSms } from "./twilio.js";

const IDEMPOTENCY_TTL_S = 36 * 60 * 60; // survive past midnight PT

function modeOf(env) {
  const m = String(env.MORNING_SMS_MODE || "shadow").toLowerCase();
  return m === "active" ? "active" : "shadow";
}

function idemKey(dateKey, kind, to) {
  return `morning-sms:${dateKey}:${kind}:${to}`;
}

/**
 * @param {object} env
 * @param {{ nowMs?: number, forceKinds?: Array<'prepare'|'meeting'>, dryRun?: boolean }} [opts]
 */
export async function runMorningSms(env, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const timeZone = env.TIMEZONE || "America/Los_Angeles";
  const mode = modeOf(env);
  const recipients = parseRecipients(env.MORNING_SMS_TO);
  const summary = {
    mode,
    recipients: recipients.map((r) => `***${r.slice(-4)}`),
    schedule: null,
    sends: [],
    skipped: [],
    errors: [],
  };

  if (recipients.length === 0) {
    summary.errors.push("MORNING_SMS_TO empty or invalid");
    return summary;
  }

  let firstAppointmentMs = null;
  try {
    firstAppointmentMs = await fetchFirstAppointmentMs(env, nowMs, timeZone);
  } catch (err) {
    summary.errors.push(`appointment lookup: ${err.message}`);
  }

  const schedule = computeMorningTimes({ nowMs, firstAppointmentMs, timeZone });
  summary.schedule = {
    dateKey: schedule.dateKey,
    reason: schedule.reason,
    firstAt: new Date(schedule.firstAtMs).toISOString(),
    secondAt: new Date(schedule.secondAtMs).toISOString(),
    firstAppointmentAt: firstAppointmentMs ? new Date(firstAppointmentMs).toISOString() : null,
  };

  const kinds = opts.forceKinds?.length
    ? opts.forceKinds
    : dueKinds(nowMs, schedule.firstAtMs, schedule.secondAtMs, SEND_GRACE_MS);

  if (kinds.length === 0) {
    summary.skipped.push("nothing due in grace window");
    return summary;
  }

  const kv = env.PORTAL_KV;
  const dry = Boolean(opts.dryRun) || mode === "shadow";

  for (const kind of kinds) {
    const body = messageForKind(kind);
    if (!body) continue;

    for (const to of recipients) {
      const key = idemKey(schedule.dateKey, kind, to);
      if (kv) {
        const seen = await kv.get(key);
        if (seen) {
          summary.skipped.push({ kind, to: `***${to.slice(-4)}`, reason: "already-sent" });
          continue;
        }
      }

      if (dry) {
        summary.sends.push({
          kind,
          to: `***${to.slice(-4)}`,
          body,
          result: { success: true, shadowed: true },
        });
        // Do not reserve idempotency keys in shadow — flipping to active the
        // same morning must still be able to deliver.
        continue;
      }

      // Reserve before send (same pattern as staff-send-text).
      if (kv) {
        try {
          await kv.put(key, `pending:${nowMs}`, { expirationTtl: IDEMPOTENCY_TTL_S });
        } catch {
          /* non-fatal */
        }
      }

      const result = await sendTwilioSms(env, { to, body });
      summary.sends.push({
        kind,
        to: `***${to.slice(-4)}`,
        body,
        result: {
          success: result.success,
          sid: result.sid || null,
          status: result.status || null,
          error: result.error || null,
          code: result.code ?? null,
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
          await kv.put(key, result.sid || `ok:${nowMs}`, { expirationTtl: IDEMPOTENCY_TTL_S });
        } catch {
          /* ignore */
        }
      }
    }
  }

  return summary;
}
