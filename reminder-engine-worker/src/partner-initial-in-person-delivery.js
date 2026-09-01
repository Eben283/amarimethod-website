import { sendOwnedEmail } from "./gmail-test-send.js";
import { executeOwnedDeliveryEffect } from "./owned-delivery-evidence.js";
import { partnerInitialInPersonNode } from "./partner-initial-in-person-workflow.js";
import { renderWorkflowText } from "./workflow-definition.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const RELEASED = "approved";
const CLIENT_LINK_FIELDS = Object.freeze({
  confirmation: Object.freeze(["rescheduleLink", "cancellationLink", "googleCalendarLink", "icalLink"]),
  "day-before": Object.freeze(["rescheduleLink", "cancellationLink"]),
});

const clean = (value) => String(value || "").trim();

function normalizedDnd(value) {
  return new Set(["true", "1", "yes", "on", "dnd"]).has(clean(value).toLowerCase());
}

function validHttps(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function dateParts(startAt, timezone) {
  const instant = new Date(startAt);
  if (!Number.isFinite(instant.getTime())) throw new Error("owned appointment start is invalid");
  let date;
  let time;
  let zone;
  try {
    date = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, weekday: "long", month: "long", day: "numeric",
    }).format(instant);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).formatToParts(instant);
    time = parts.filter((part) => new Set(["hour", "minute", "dayPeriod", "literal"]).has(part.type))
      .map((part) => part.value).join("").trim();
    zone = parts.find((part) => part.type === "timeZoneName")?.value;
  } catch {
    throw new Error("owned appointment timezone is invalid");
  }
  if (!date || !time || !zone) throw new Error("owned appointment time is incomplete");
  return { date, time, zone };
}

/**
 * Resolve the delivery subject from owned CRM identity only. The recursive
 * lineage follows a Staff reschedule to its active replacement while keeping
 * the Reminder enrollment's original idempotency identity stable.
 */
export async function readPartnerInitialDeliveryContext(db, enrollment) {
  if (!db?.prepare) throw new Error("owned CRM appointment store is unavailable");
  const reference = clean(enrollment?.appointmentId);
  if (!reference) throw new Error("owned appointment reference is required");
  const result = await db.prepare(
    `WITH RECURSIVE root(id) AS (
       SELECT id FROM appointments
        WHERE id = ? OR provider_appointment_id = ?
     ), lineage(id) AS (
       SELECT id FROM root
       UNION
       SELECT child.id
         FROM appointments child
         JOIN lineage parent ON child.replaces_appointment_id = parent.id
     )
     SELECT appointment.id AS appointment_id,
            appointment.contact_id, appointment.service_id,
            appointment.provider_appointment_id, appointment.provider_calendar_id,
            appointment.status, appointment.starts_at, appointment.ends_at,
            appointment.timezone, appointment.meeting_location,
            appointment.provider_meeting_location, appointment.authority,
            appointment.provider_sync_state, appointment.revision,
            contact.first_name, contact.last_name, contact.display_name,
            contact.email_normalized, contact.phone_e164, contact.archived_at,
            service.name AS service_name, service.service_family,
            COALESCE((SELECT attribute_value FROM contact_attributes
                       WHERE contact_id = contact.id
                         AND attribute_key IN ('additional_information', '5cEfs0e46quKY8J2HULr')
                       ORDER BY CASE WHEN attribute_key = 'additional_information' THEN 0 ELSE 1 END,
                                datetime(updated_at) DESC LIMIT 1), '') AS additional_information,
            COALESCE((SELECT attribute_value FROM contact_attributes
                       WHERE contact_id = contact.id AND attribute_key = 'system.dnd'
                       ORDER BY datetime(updated_at) DESC LIMIT 1), 'off') AS dnd_state,
            COALESCE((SELECT state FROM consents
                       WHERE contact_id = contact.id AND channel = 'email' AND state <> 'unknown'
                       ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1), 'unknown') AS email_consent_state,
            COALESCE((SELECT state FROM consents
                       WHERE contact_id = contact.id AND channel = 'sms' AND state <> 'unknown'
                       ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1), 'unknown') AS sms_consent_state
       FROM lineage
       JOIN appointments appointment ON appointment.id = lineage.id
       JOIN contacts contact ON contact.id = appointment.contact_id
       JOIN services service ON service.id = appointment.service_id
      WHERE appointment.service_id = 'partner-initial'
        AND appointment.status IN ('booked', 'confirmed')
      ORDER BY datetime(appointment.updated_at) DESC, appointment.id
      LIMIT 2`,
  ).bind(reference, reference).all();
  const rows = result?.results || [];
  if (!rows.length) throw new Error("active owned Partner Initial appointment was not found");
  if (rows.length !== 1) throw new Error("owned Partner Initial appointment lineage is ambiguous");
  const row = rows[0];
  if (row.archived_at) throw new Error("owned contact is archived");

  const enrollmentContact = clean(enrollment?.contactId);
  if (enrollmentContact && enrollmentContact !== row.contact_id) {
    const crosswalk = await db.prepare(
      `SELECT external_id FROM external_records
        WHERE object_type = 'contact' AND contact_id = ? AND external_id = ?
        LIMIT 2`,
    ).bind(row.contact_id, enrollmentContact).all();
    if ((crosswalk?.results || []).length !== 1) {
      throw new Error("reminder contact does not match owned CRM identity");
    }
  }
  return Object.freeze({
    appointmentId: row.appointment_id,
    ownedContactId: row.contact_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    firstName: clean(row.first_name) || clean(row.display_name).split(/\s+/)[0] || "there",
    contactName: clean(row.display_name) || [row.first_name, row.last_name].map(clean).filter(Boolean).join(" "),
    clientEmail: clean(row.email_normalized).toLowerCase(),
    clientPhone: clean(row.phone_e164),
    additionalInformation: clean(row.additional_information),
    startAt: row.starts_at,
    timezone: clean(row.timezone) || "America/Los_Angeles",
    dnd: normalizedDnd(row.dnd_state),
    emailConsent: clean(row.email_consent_state) || "unknown",
    smsConsent: clean(row.sms_consent_state) || "unknown",
    authority: row.authority,
    providerSyncState: row.provider_sync_state,
    revision: Number(row.revision || 1),
  });
}

export function partnerInitialInPersonDeliveryEligibility(env, flow, step, enrollment) {
  if (flow?.mode !== "active") return { eligible: false, reason: "workflow-hard-shadow" };
  if (flow?.workflowDocument?.sourceGaps?.length) return { eligible: false, reason: "source-gaps-open" };
  if (env?.PARTNER_INITIAL_IN_PERSON_BEHAVIOR_RELEASE !== RELEASED) return { eligible: false, reason: "behavior-release-disabled" };
  if (env?.PARTNER_INITIAL_IN_PERSON_DELIVERY_RELEASE !== RELEASED) return { eligible: false, reason: "delivery-release-disabled" };
  if (flow?.flowKey !== "partner-initial-in-person") return { eligible: false, reason: "not-partner-initial" };
  if (!flow?.calendarIds?.includes(enrollment?.calendarId) && !flow?.serviceIds?.includes("partner-initial")) {
    return { eligible: false, reason: "not-partner-initial" };
  }
  if (!partnerInitialInPersonNode(step?.template, flow.workflowDocument)) return { eligible: false, reason: "not-owned-step" };
  if (!env?.CRM_DB?.prepare) return { eligible: false, reason: "owned-crm-unavailable" };
  if (!env?.REMINDER_DB?.prepare || !env?.REMINDER_DB?.batch) return { eligible: false, reason: "delivery-evidence-unavailable" };
  if (!env?.OWNED_SMS?.fetch || !clean(env.WORKER_AUTH_SECRET)) return { eligible: false, reason: "owned-sms-unavailable" };
  if (!EMAIL.test(clean(env.GARRETT_INTERNAL_EMAIL)) || !E164.test(clean(env.GARRETT_INTERNAL_PHONE_E164))) {
    return { eligible: false, reason: "internal-recipient-not-configured" };
  }
  return { eligible: true };
}

function requiredLinks(template, links = {}) {
  const values = {};
  for (const field of CLIENT_LINK_FIELDS[template] || []) {
    const value = clean(links[field]);
    if (!validHttps(value)) throw new Error(`owned appointment ${field} is unavailable`);
    values[field] = value;
  }
  return values;
}

function clientPolicy(context, channel) {
  if (context.dnd) return "do_not_disturb";
  if (channel === "email" && context.emailConsent === "revoked") return "email_opted_out";
  if (channel === "sms" && context.smsConsent === "revoked") return "sms_opted_out";
  return null;
}

async function sendOwnedSms(env, message) {
  if (!env?.OWNED_SMS?.fetch || !env?.WORKER_AUTH_SECRET) {
    return { success: false, error: "owned SMS provider is unavailable" };
  }
  const response = await env.OWNED_SMS.fetch("https://owned-sms/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WORKER_AUTH_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success !== true || !clean(body?.messageId)) {
    return { success: false, error: `owned SMS provider rejected the command (${response.status})` };
  }
  return { success: true, messageId: clean(body.messageId) };
}

/**
 * Render and deliver one source-exact Partner Initial node. Production cannot
 * reach this function in the current document: it is source-level shadow and
 * declares unresolved gaps. The injected SMS edge accepts an E.164 destination,
 * never a GHL contact id, so selecting a future provider does not change this
 * lifecycle contract.
 */
export async function deliverPartnerInitialInPersonStep(env, step, enrollment, services = {}, workflow) {
  const node = partnerInitialInPersonNode(step?.template, workflow);
  if (!node) return { success: false, error: "unknown owned Partner Initial step" };
  try {
    const context = services.readContext
      ? await services.readContext(env, enrollment)
      : await readPartnerInitialDeliveryContext(env.CRM_DB, enrollment);
    const links = requiredLinks(step.template, services.manageLinks
      ? await services.manageLinks(context, enrollment)
      : {});
    const when = dateParts(context.startAt, context.timezone);
    const values = {
      firstName: context.firstName,
      userFirstName: "Garrett",
      contactName: context.contactName,
      calendarName: context.serviceName,
      appointmentDate: when.date,
      appointmentTime: when.time,
      appointmentTimezone: when.zone,
      additionalInformation: context.additionalInformation,
      ...links,
    };
    const subject = renderWorkflowText(node.message.subject, values);
    const text = renderWorkflowText(node.message.body, values);
    const idempotencyKey = `partner-initial:${context.appointmentId}:v${enrollment.definitionVersion || 2}:${step.stepIndex}`;
    const executeEffect = services.executeEffect || executeOwnedDeliveryEffect;
    const evidenceBase = {
      flowKey: "partner-initial-in-person",
      enrollmentId: `partner-initial-in-person:${clean(enrollment.appointmentId)}`,
      stepIndex: Number(step.stepIndex),
      definitionVersion: Number(enrollment.definitionVersion || 2),
      idempotencyKey,
      channel: node.message.channel,
      subject,
      text,
    };
    if (node.message.audience === "client") {
      const blocked = clientPolicy(context, node.message.channel);
      if (blocked) return { success: false, error: blocked };
    }
    if (node.message.channel === "email") {
      const recipient = node.message.audience === "internal" ? clean(env.GARRETT_INTERNAL_EMAIL) : context.clientEmail;
      if (!EMAIL.test(recipient)) return { success: false, error: "recipient email is unavailable", recipient };
      const sendEmail = services.sendEmail || sendOwnedEmail;
      const actor = clean(node.message.from).toLowerCase().includes("garrett@") ? "Garrett" : "Eben";
      return {
        recipient,
        ...(await executeEffect(env.REMINDER_DB, {
          ...evidenceBase,
          recipient,
          provider: `gmail-${actor.toLowerCase()}`,
        }, () => sendEmail(env, { to: recipient, subject, text, preheader: node.message.preheader, actor, idempotencyKey }))),
      };
    }
    const recipient = node.message.audience === "internal" ? clean(env.GARRETT_INTERNAL_PHONE_E164) : context.clientPhone;
    if (!E164.test(recipient)) return { success: false, error: "recipient phone is unavailable", recipient };
    const sendSms = services.sendSms || ((message) => sendOwnedSms(env, message));
    return {
      recipient,
      ...(await executeEffect(env.REMINDER_DB, {
        ...evidenceBase,
        recipient,
        provider: "owned-sms",
      }, () => sendSms({ to: recipient, text, idempotencyKey }))),
    };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
}
