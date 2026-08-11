import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { sendOwnedEmail } from "./gmail-test-send.js";
import { initialVirtualNode } from "./initial-virtual-workflow.js";
import { renderWorkflowText } from "./workflow-definition.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const clean = (value) => String(value || "").trim();
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

function appointmentTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "your scheduled date", time: "your scheduled time", full: "your scheduled time" };
  const day = DATE.format(date);
  const time = TIME.format(date);
  return { date: day, time, full: `${day} at ${time}` };
}

function customField(contact, key) {
  const fields = contact?.customFields || contact?.customField || contact?.custom_fields || [];
  if (Array.isArray(fields)) {
    const match = fields.find((field) => [field?.key, field?.id, field?.name].map((value) => clean(value).toLowerCase()).includes(key.toLowerCase()));
    return clean(match?.value || match?.fieldValue);
  }
  return clean(fields?.[key]);
}

export function initialVirtualCutoverEligibility(env, flow, step, enrollment) {
  if (env?.INITIAL_VIRTUAL_CUTOVER !== "enabled") return { eligible: false, reason: "cutover-disabled" };
  if (flow?.flowKey !== "initial-virtual" || !flow?.calendarIds?.includes(enrollment?.calendarId)) return { eligible: false, reason: "not-initial-virtual" };
  if (!initialVirtualNode(step?.template, flow.workflowDocument)) return { eligible: false, reason: "not-owned-step" };
  if (!EMAIL.test(clean(env.GARRETT_INTERNAL_EMAIL)) || !clean(env.GARRETT_INTERNAL_CONTACT_ID)) return { eligible: false, reason: "internal-recipient-not-configured" };
  return { eligible: true };
}

async function read(env, path) {
  const token = await getAccessToken(env);
  const response = await fetch(`${GHL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } });
  if (!response.ok) throw new Error(`GHL read ${response.status}`);
  return response.json();
}

export async function deliverInitialVirtualStep(env, step, enrollment, services = {}, workflow) {
  const readAppointment = services.read || read;
  const sendEmail = services.sendEmail || sendOwnedEmail;
  const sendSms = services.sendSms || ((message) => sendConversationMessage({ env }, message));
  const [appointmentData, contactData] = await Promise.all([
    readAppointment(env, `/calendars/events/appointments/${encodeURIComponent(enrollment.appointmentId)}`),
    readAppointment(env, `/contacts/${encodeURIComponent(enrollment.contactId)}`),
  ]);
  const appointment = appointmentData.appointment || appointmentData.event || appointmentData || {};
  const contact = contactData.contact || contactData || {};
  const location = clean(appointment.meetingLocation || appointment.meeting_location || appointment.location || appointment.address);
  if (!location) return { success: false, error: "virtual meeting link is unavailable" };
  const name = clean(contact.firstName || contact.first_name || contact.name?.split(" ")[0]) || "there";
  const clientEmail = clean(contact.email || contact.emailAddress || contact.email_address);
  const calendar = clean(appointment.calendarName || appointment.calendar?.name) || "Initial Session — Virtual";
  const when = appointmentTime(appointment.startTime || appointment.startAt || enrollment.startAt);
  const links = [
    clean(appointment.addToGoogleCalendar || appointment.add_to_google_calendar) && `Add to Google Calendar: ${clean(appointment.addToGoogleCalendar || appointment.add_to_google_calendar)}`,
    clean(appointment.addToIcalOutlook || appointment.add_to_ical_outlook) && `Add to iCal/Outlook: ${clean(appointment.addToIcalOutlook || appointment.add_to_ical_outlook)}`,
    clean(appointment.rescheduleLink || appointment.reschedule_link) && `Reschedule: ${clean(appointment.rescheduleLink || appointment.reschedule_link)}`,
    clean(appointment.cancellationLink || appointment.cancellation_link) && `Cancel: ${clean(appointment.cancellationLink || appointment.cancellation_link)}`,
  ].filter(Boolean).join("\n");
  const additionalInformation = clean(contact.additional_information) || customField(contact, "additional_information") || customField(contact, "5cEfs0e46quKY8J2HULr");
  const values = { firstName: name, userFirstName: "Garrett", contactName: clean(contact.name) || name, calendarName: calendar, appointmentDate: when.date, appointmentTime: when.time, appointmentFull: when.full, appointmentLinks: links, location, additionalInformation };
  const node = initialVirtualNode(step.template, workflow);
  if (!node) return { success: false, error: "unknown owned step" };
  const subject = renderWorkflowText(node.message.subject, values);
  const text = renderWorkflowText(node.message.body, values);
  const email = async (to, subjectLine, body) => {
    if (!EMAIL.test(to)) return { success: false, error: "recipient email is unavailable" };
    return sendEmail(env, { to, subject: subjectLine, text: body });
  };
  if (node.message.channel === "email") {
    const recipient = node.message.audience === "internal" ? clean(env.GARRETT_INTERNAL_EMAIL) : clientEmail;
    return { recipient, ...(await email(recipient, subject, text)) };
  }
  const recipient = node.message.audience === "internal" ? clean(env.GARRETT_INTERNAL_CONTACT_ID) : enrollment.contactId;
  return { recipient, ...(await sendSms({ channel: "sms", contactId: recipient, message: text })) };
}
