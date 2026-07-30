// Amari Ops flip alerts — Eben only, on incident open (not while red).
// Money/booking → SMS + email via GHL conversation send to OPS_ALERT_CONTACT_ID.
// Never throws. Missing contact id = log only (deploy-safe).

import { sendConversationMessage } from "./ghl-send.js";

const SEVERITY_CHANNELS = Object.freeze({
  money: Object.freeze(["sms", "email"]),
  booking: Object.freeze(["sms", "email"]),
  wrong_message: Object.freeze(["sms"]),
  infra: Object.freeze([]), // app only
});

function channelsFor(severity) {
  return SEVERITY_CHANNELS[severity] || [];
}

function personBit(incident) {
  if (incident.personLabel) return incident.personLabel;
  if (incident.contactId) return `contact ${incident.contactId}`;
  return "unknown contact";
}

export function buildFlipCopy(incident) {
  const who = personBit(incident);
  const path = incident.pathId || "path";
  const title = incident.title || "Ops incident";
  const hop = incident.failedHopId ? ` (hop: ${incident.failedHopId})` : "";
  const opsUrl = `https://www.amarimethod.com/ops#path/${encodeURIComponent(path)}`;
  const sms = `Amari Ops · ${title} — ${who}${hop}. ${opsUrl}`;
  const subject = `Amari Ops · ${title}`;
  const html = [
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    `<p>${escapeHtml(who)}${hop ? escapeHtml(hop) : ""}</p>`,
    `<p>Path: <code>${escapeHtml(path)}</code></p>`,
    incident.correlationId
      ? `<p>Correlation: <code>${escapeHtml(incident.correlationId)}</code></p>`
      : "",
    incident.lawId ? `<p>Law: <code>${escapeHtml(incident.lawId)}</code></p>` : "",
    `<p>Incident: <code>${escapeHtml(incident.id || "")}</code></p>`,
    `<p><a href="${escapeHtml(opsUrl)}">Open in Amari Ops</a></p>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { sms: sms.slice(0, 720), subject, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Deliver flip alert for a newly opened incident.
 * @returns {Promise<{sent:boolean,shadowed?:boolean,reason?:string,results?:object[]}>}
 */
export async function notifyOpsFlip(context, incident) {
  try {
    const env = context?.env || context;
    const severity = incident?.severity || "infra";
    const channels = channelsFor(severity);
    if (channels.length === 0) {
      return { sent: false, reason: "infra-app-only" };
    }

    const alertContactId = env?.OPS_ALERT_CONTACT_ID;
    if (!alertContactId) {
      console.error(
        `[ops-notify] OPS_ALERT_CONTACT_ID unset — flip not delivered: ${incident?.title}`,
      );
      return { sent: false, reason: "no-contact" };
    }

    // Optional shadow: log would_send without messaging (local / staging).
    if (String(env?.OPS_ALERT_MODE || "").toLowerCase() === "shadow") {
      console.log(
        `[ops-notify] shadow flip ${severity} → ${channels.join("+")}: ${incident?.title}`,
      );
      return { sent: false, shadowed: true, reason: "shadow" };
    }

    const copy = buildFlipCopy(incident);
    const results = [];
    for (const channel of channels) {
      if (channel === "sms") {
        results.push(
          await sendConversationMessage(context, {
            channel: "sms",
            contactId: alertContactId,
            message: copy.sms,
          }),
        );
      } else if (channel === "email") {
        results.push(
          await sendConversationMessage(context, {
            channel: "email",
            contactId: alertContactId,
            subject: copy.subject,
            html: copy.html,
          }),
        );
      }
    }
    const anyOk = results.some((r) => r && r.success);
    if (!anyOk) {
      console.error(`[ops-notify] flip send failed: ${JSON.stringify(results)}`);
    }
    return { sent: anyOk, results };
  } catch (err) {
    console.error(`[ops-notify] threw: ${err && err.message}`);
    return { sent: false, reason: "threw" };
  }
}

export const __test = { channelsFor, buildFlipCopy, SEVERITY_CHANNELS };
