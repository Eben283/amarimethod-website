import { fetchFirstAppointmentMs } from "./appointments.js";
import {
  computeMorningTimes,
  dueKinds,
  messageForKind,
  SEND_GRACE_MS,
} from "./schedule.js";
import { parseContactIds, sendGhlSms } from "./ghl-sms.js";

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

/**
 * @param {object} env
 * @param {{ nowMs?: number, forceKinds?: Array<'prepare'|'meeting'>, dryRun?: boolean }} [opts]
 */
export async function runMorningSms(env, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const timeZone = env.TIMEZONE || "America/Los_Angeles";
  const mode = modeOf(env);
  const recipients = parseContactIds(env.MORNING_SMS_CONTACT_IDS);
  const summary = {
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

    for (const contactId of recipients) {
      const key = idemKey(schedule.dateKey, kind, contactId);
      if (kv) {
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

  return summary;
}
