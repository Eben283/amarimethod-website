import { gmailConfigured } from "../../crm-mirror-worker/src/gmail.js";
import { sendOwnedEmail } from "./gmail-test-send.js";
import { executeOwnedDeliveryEffect } from "./owned-delivery-evidence.js";
import { ownedSmsConfigured, sendOwnedSms, validOwnedSmsRecipient } from "./owned-sms.js";
import { renderWorkflowText } from "./workflow-definition.js";
import { issueAppointmentManageToken } from "../../functions/lib/appointment-manage-token.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OWNED_ORIGIN = "https://www.amarimethod.com";
const RECOVERY_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const clean = (value) => String(value || "").trim();

function normalizedDnd(value) {
  return new Set(["true", "1", "yes", "on", "dnd"]).has(clean(value).toLowerCase());
}

export function ownedNoShowRecoveryUrl(value) {
  try {
    const url = new URL(clean(value));
    if (url.origin !== OWNED_ORIGIN || url.username || url.password || url.hash || url.pathname.startsWith("/api/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function noShowDeliveryReadiness(env) {
  if (!env?.CRM_DB?.prepare) return { eligible: false, reason: "owned-crm-unavailable" };
  if (!env?.REMINDER_DB?.prepare || !env?.REMINDER_DB?.batch) return { eligible: false, reason: "delivery-evidence-unavailable" };
  if (!gmailConfigured(env)) return { eligible: false, reason: "owned-email-unavailable" };
  if (!ownedSmsConfigured(env)) return { eligible: false, reason: "owned-sms-unavailable" };
  if (clean(env?.APPOINTMENT_MANAGE_LINK_SECRET).length < 32) return { eligible: false, reason: "owned-recovery-link-unavailable" };
  return { eligible: true };
}

export async function createNoShowRecoveryLink(
  env,
  context,
  issuedAtMs = Date.now(),
  verificationNowMs = Date.now(),
) {
  if (!context?.appointmentId || !context?.ownedContactId || !Number.isInteger(Number(context?.revision)) ||
      clean(context?.status).toLowerCase() !== "no_show" || !clean(context?.serviceId) ||
      !new Set(["owned", "provider_mirror"]).has(clean(context?.authority)) ||
      !new Set(["synced", "not_required"]).has(clean(context?.providerSyncState))) {
    throw new Error("owned no-show recovery identity is unavailable");
  }
  const token = await issueAppointmentManageToken(env?.APPOINTMENT_MANAGE_LINK_SECRET, {
    appointmentId: context.appointmentId,
    contactId: context.ownedContactId,
    revision: Number(context.revision),
    capabilities: ["recovery"],
    iat: issuedAtMs,
    exp: issuedAtMs + RECOVERY_LINK_TTL_MS,
  }, verificationNowMs);
  const link = new URL("/appointment/manage", OWNED_ORIGIN);
  link.searchParams.set("action", "recovery");
  link.searchParams.set("token", token);
  return link.toString();
}

export function noShowDeliveryEligibility(env, flow, step, enrollment) {
  if (flow?.flowKey !== "no-show-recovery" || !flow?.calendarIds?.includes(enrollment?.calendarId)) {
    return { eligible: false, reason: "not-no-show-recovery" };
  }
  if (flow?.mode !== "active") return { eligible: false, reason: "workflow-not-active" };
  if (env?.NO_SHOW_DELIVERY_RELEASE !== "approved") return { eligible: false, reason: "no-show-delivery-disabled" };
  if (!flow.workflowDocument?.nodes?.some((node) => node.action.template === step?.template)) {
    return { eligible: false, reason: "not-owned-step" };
  }
  return noShowDeliveryReadiness(env);
}

export async function readNoShowDeliveryContext(db, enrollment) {
  if (!db?.prepare) throw new Error("owned CRM appointment store is unavailable");
  const reference = clean(enrollment?.appointmentId);
  if (!reference) throw new Error("owned no-show appointment reference is required");
  const result = await db.prepare(
    `SELECT appointment.id AS appointment_id, appointment.contact_id,
            appointment.provider_appointment_id, appointment.provider_calendar_id,
            appointment.status, appointment.service_id, appointment.authority,
            appointment.provider_sync_state, appointment.revision,
            contact.first_name, contact.display_name,
            contact.email_normalized, contact.phone_e164,
            contact.email_authority, contact.phone_authority, contact.archived_at,
            COALESCE((SELECT attribute_value FROM contact_attributes
                       WHERE contact_id = contact.id AND attribute_key = 'system.dnd'
                       ORDER BY datetime(updated_at) DESC LIMIT 1), 'off') AS dnd_state,
            COALESCE((SELECT state FROM consents
                       WHERE contact_id = contact.id AND channel = 'email'
                         AND CASE WHEN contact.email_authority = 'owned'
                           THEN destination_normalized = contact.email_normalized AND destination_sha256 IS NOT NULL
                           ELSE state <> 'unknown' AND (destination_normalized IS NULL OR destination_normalized = contact.email_normalized) END
                       ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1), 'unknown') AS email_consent_state,
            COALESCE((SELECT state FROM consents
                       WHERE contact_id = contact.id AND channel = 'sms'
                         AND CASE WHEN contact.phone_authority = 'owned'
                           THEN destination_normalized = contact.phone_e164 AND destination_sha256 IS NOT NULL
                           ELSE state <> 'unknown' AND (destination_normalized IS NULL OR destination_normalized = contact.phone_e164) END
                       ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1), 'unknown') AS sms_consent_state
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
      WHERE (appointment.id = ? OR appointment.provider_appointment_id = ?)
        AND appointment.status = 'no_show'
      ORDER BY datetime(appointment.updated_at) DESC, appointment.id
      LIMIT 2`,
  ).bind(reference, reference).all();
  const rows = result?.results || [];
  if (!rows.length) throw new Error("owned no-show appointment was not found");
  if (rows.length !== 1) throw new Error("owned no-show appointment identity is ambiguous");
  const row = rows[0];
  if (row.archived_at) throw new Error("owned contact is archived");
  if (clean(enrollment?.calendarId) && clean(row.provider_calendar_id) !== clean(enrollment.calendarId)) {
    throw new Error("no-show calendar does not match owned CRM identity");
  }
  const enrollmentContact = clean(enrollment?.contactId);
  if (enrollmentContact && enrollmentContact !== row.contact_id) {
    const crosswalk = await db.prepare(
      `SELECT external_id FROM external_records
        WHERE provider = 'ghl' AND object_type = 'contact'
          AND contact_id = ? AND external_id = ?
        LIMIT 2`,
    ).bind(row.contact_id, enrollmentContact).all();
    if ((crosswalk?.results || []).length !== 1) {
      throw new Error("no-show contact does not match owned CRM identity");
    }
  }
  return Object.freeze({
    appointmentId: row.appointment_id,
    ownedContactId: row.contact_id,
    serviceId: row.service_id,
    status: row.status,
    authority: row.authority,
    providerSyncState: row.provider_sync_state,
    revision: Number(row.revision),
    firstName: clean(row.first_name) || clean(row.display_name).split(/\s+/)[0] || "there",
    clientEmail: clean(row.email_normalized).toLowerCase(),
    clientPhone: clean(row.phone_e164),
    dnd: normalizedDnd(row.dnd_state),
    emailConsent: clean(row.email_consent_state) || "unknown",
    smsConsent: clean(row.sms_consent_state) || "unknown",
  });
}

function clientPolicy(context, channel) {
  if (context.dnd) return "do_not_disturb";
  if (channel === "email" && context.emailConsent === "revoked") return "email_opted_out";
  if (channel === "sms" && context.smsConsent === "revoked") return "sms_opted_out";
  return null;
}

export async function deliverNoShowStep(env, step, enrollment, services = {}, workflow) {
  const node = workflow?.nodes?.find((candidate) => candidate.action.template === step?.template);
  if (!node) return { success: false, error: "unknown owned step" };
  try {
    const context = services.readContext
      ? await services.readContext(env, enrollment)
      : await readNoShowDeliveryContext(env.CRM_DB, enrollment);
    const blocked = clientPolicy(context, node.message.channel);
    if (blocked) return { success: false, error: blocked };
    const stableIssueTime = Number.isFinite(Number(step?.dueAt)) ? Number(step.dueAt) : Date.now();
    const rescheduleLink = services.recoveryUrl
      ? ownedNoShowRecoveryUrl(await services.recoveryUrl(context, enrollment))
      : ownedNoShowRecoveryUrl(await createNoShowRecoveryLink(env, context, stableIssueTime));
    if (["reschedule-sms", "one-day-follow-up"].includes(step.template) && !rescheduleLink) {
      return { success: false, error: "owned no-show recovery link is unavailable" };
    }
    const values = { firstName: context.firstName, rescheduleLink: rescheduleLink || "" };
    const subject = renderWorkflowText(node.message.subject, values);
    const text = renderWorkflowText(node.message.body, values);
    const definitionVersion = Number(enrollment.definitionVersion || workflow?.version || 4);
    const stepIndex = Number(step.stepIndex);
    const idempotencyKey = `no-show-recovery:${context.appointmentId}:v${definitionVersion}:${stepIndex}`;
    const evidenceBase = {
      flowKey: "no-show-recovery",
      enrollmentId: `no-show-recovery:${clean(enrollment.appointmentId)}`,
      stepIndex,
      definitionVersion,
      idempotencyKey,
      channel: node.message.channel,
      subject,
      text,
    };
    const executeEffect = services.executeEffect || executeOwnedDeliveryEffect;
    if (node.message.channel === "email") {
      const recipient = context.clientEmail;
      if (!EMAIL.test(recipient)) return { success: false, error: "recipient email is unavailable", recipient };
      const sendEmail = services.sendEmail || sendOwnedEmail;
      return {
        recipient,
        ...(await executeEffect(env.REMINDER_DB, {
          ...evidenceBase, recipient, provider: "gmail-garrett",
        }, () => sendEmail(env, {
          actor: "Garrett", to: recipient, subject, text,
          preheader: renderWorkflowText(node.message.preheader, values), idempotencyKey,
        }))),
      };
    }
    const recipient = context.clientPhone;
    if (!validOwnedSmsRecipient(recipient)) return { success: false, error: "recipient phone is unavailable", recipient };
    const sendSms = services.sendSms || ((message) => sendOwnedSms(env, message));
    return {
      recipient,
      ...(await executeEffect(env.REMINDER_DB, {
        ...evidenceBase, recipient, provider: "owned-sms",
      }, () => sendSms({ to: recipient, text, idempotencyKey }))),
    };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
}
