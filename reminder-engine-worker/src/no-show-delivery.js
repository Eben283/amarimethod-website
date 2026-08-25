import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { sendOwnedEmail } from "./gmail-test-send.js";
import { renderWorkflowText } from "./workflow-definition.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const clean = (value) => String(value || "").trim();

export function noShowDeliveryEligibility(env, flow, step, enrollment) {
  if (flow?.flowKey !== "no-show-recovery" || !flow?.calendarIds?.includes(enrollment?.calendarId)) {
    return { eligible: false, reason: "not-no-show-recovery" };
  }
  if (flow?.mode !== "active") return { eligible: false, reason: "workflow-not-active" };
  if (env?.NO_SHOW_DELIVERY_RELEASE !== "approved") return { eligible: false, reason: "no-show-delivery-disabled" };
  if (!flow.workflowDocument?.nodes?.some((node) => node.action.template === step?.template)) {
    return { eligible: false, reason: "not-owned-step" };
  }
  return { eligible: true };
}

async function read(env, path) {
  const token = await getAccessToken(env);
  const response = await fetch(`${GHL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (!response.ok) throw new Error(`GHL read ${response.status}`);
  return response.json();
}

export async function deliverNoShowStep(env, step, enrollment, services = {}, workflow) {
  const readRecord = services.read || read;
  const sendEmail = services.sendEmail || sendOwnedEmail;
  const sendSms = services.sendSms || ((message) => sendConversationMessage({ env }, message));
  const [appointmentData, contactData] = await Promise.all([
    readRecord(env, `/calendars/events/appointments/${encodeURIComponent(enrollment.appointmentId)}`),
    readRecord(env, `/contacts/${encodeURIComponent(enrollment.contactId)}`),
  ]);
  const appointment = appointmentData.appointment || appointmentData.event || appointmentData || {};
  const contact = contactData.contact || contactData || {};
  const node = workflow?.nodes?.find((candidate) => candidate.action.template === step?.template);
  if (!node) return { success: false, error: "unknown owned step" };

  const firstName = clean(contact.firstName || contact.first_name || contact.name?.split(" ")[0]) || "there";
  const rescheduleLink = clean(appointment.rescheduleLink || appointment.reschedule_link);
  if (["reschedule-sms", "one-day-follow-up"].includes(step.template) && !rescheduleLink) {
    return { success: false, error: "appointment reschedule link is unavailable" };
  }
  const values = { firstName, rescheduleLink };
  const subject = renderWorkflowText(node.message.subject, values);
  const text = renderWorkflowText(node.message.body, values);

  if (node.message.channel === "email") {
    const recipient = clean(contact.email || contact.emailAddress || contact.email_address);
    if (!EMAIL.test(recipient)) return { success: false, error: "recipient email is unavailable" };
    return {
      recipient,
      ...(await sendEmail(env, {
        actor: "Garrett",
        to: recipient,
        subject,
        text,
        preheader: renderWorkflowText(node.message.preheader, values),
      })),
    };
  }

  const recipient = enrollment.contactId;
  return { recipient, ...(await sendSms({ channel: "sms", contactId: recipient, message: text })) };
}
