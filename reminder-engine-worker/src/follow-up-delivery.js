// Follow-Up's delivery adapter is intentionally separate from its shadow
// workflow. It is unreachable unless the explicit behavior-release variable
// is set, and that release remains a later Eben-approved action.

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { sendOwnedEmail } from "./gmail-test-send.js";
import { renderWorkflowText } from "./workflow-definition.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const clean = (value) => String(value || "").trim();
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

function appointmentTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "your scheduled date", time: "your scheduled time" };
  return { date: DATE.format(date), time: TIME.format(date) };
}

function customField(contact, key) {
  const fields = contact?.customFields || contact?.customField || contact?.custom_fields || [];
  if (!Array.isArray(fields)) return "";
  const match = fields.find((field) => [field?.key, field?.id, field?.name].map((value) => clean(value).toLowerCase()).includes(key.toLowerCase()));
  return clean(match?.value || match?.fieldValue);
}

export function followUpDeliveryEligibility(env, flow, step, enrollment) {
  if (env?.FOLLOW_UP_DELIVERY_RELEASE !== "approved") return { eligible: false, reason: "follow-up-delivery-disabled" };
  if (flow?.flowKey !== "follow-up-session-reminders" || !flow.calendarIds?.includes(enrollment?.calendarId)) return { eligible: false, reason: "not-follow-up" };
  if (!flow.workflowDocument?.nodes?.some((node) => node.action.template === step?.template)) return { eligible: false, reason: "not-owned-step" };
  if (!EMAIL.test(clean(env.GARRETT_INTERNAL_EMAIL)) || !clean(env.GARRETT_INTERNAL_CONTACT_ID)) return { eligible: false, reason: "internal-recipient-not-configured" };
  return { eligible: true };
}

async function read(env, path) {
  const token = await getAccessToken(env);
  const response = await fetch(`${GHL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } });
  if (!response.ok) throw new Error(`GHL read ${response.status}`);
  return response.json();
}

export async function deliverFollowUpStep(env, step, enrollment, services = {}, workflow) {
  const readRecord = services.read || read;
  const sendEmail = services.sendEmail || sendOwnedEmail;
  const sendSms = services.sendSms || ((message) => sendConversationMessage({ env }, message));
  const [appointmentData, contactData] = await Promise.all([
    readRecord(env, `/calendars/events/appointments/${encodeURIComponent(enrollment.appointmentId)}`),
    readRecord(env, `/contacts/${encodeURIComponent(enrollment.contactId)}`),
  ]);
  const appointment = appointmentData.appointment || appointmentData.event || appointmentData || {};
  const contact = contactData.contact || contactData || {};
  const meetingLocation = clean(appointment.meetingLocation || appointment.meeting_location || appointment.location || appointment.address);
  if (!meetingLocation) return { success: false, error: "appointment connection details are unavailable" };

  const node = workflow?.nodes?.find((candidate) => candidate.action.template === step.template);
  if (!node) return { success: false, error: "unknown owned step" };
  const when = appointmentTime(appointment.startTime || appointment.startAt || enrollment.startAt);
  const values = {
    firstName: clean(contact.firstName || contact.first_name || contact.name?.split(" ")[0]) || "there",
    contactName: clean(contact.name) || clean(contact.firstName || contact.first_name) || "Client",
    calendarName: clean(appointment.calendarName || appointment.calendar?.name) || "Follow-up Session",
    appointmentDate: when.date,
    appointmentTime: when.time,
    meetingLocation,
    rescheduleLink: clean(appointment.rescheduleLink || appointment.reschedule_link),
    cancellationLink: clean(appointment.cancellationLink || appointment.cancellation_link),
    addToGoogleCalendar: clean(appointment.addToGoogleCalendar || appointment.add_to_google_calendar),
    addToIcalOutlook: clean(appointment.addToIcalOutlook || appointment.add_to_ical_outlook),
    additionalInformation: clean(contact.additional_information) || customField(contact, "additional_information") || customField(contact, "5cEfs0e46quKY8J2HULr"),
  };
  const subject = renderWorkflowText(node.message.subject, values);
  const text = renderWorkflowText(node.message.body, values);
  if (node.message.channel === "email") {
    const recipient = node.message.audience === "internal" ? clean(env.GARRETT_INTERNAL_EMAIL) : clean(contact.email || contact.emailAddress || contact.email_address);
    if (!EMAIL.test(recipient)) return { success: false, error: "recipient email is unavailable" };
    return { recipient, ...(await sendEmail(env, { to: recipient, subject, text })) };
  }
  const recipient = node.message.audience === "internal" ? clean(env.GARRETT_INTERNAL_CONTACT_ID) : enrollment.contactId;
  return { recipient, ...(await sendSms({ channel: "sms", contactId: recipient, message: text })) };
}
