import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { sendOwnedEmail } from "./gmail-test-send.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const CALENDAR_IDS = new Set(["G7OAnnJuFbMF6nQSlZVQ", "EM6vB2mq7EAdGCbUb3j1"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function initialInPersonCutoverEligibility(env, flow, step, enrollment) {
  if (env?.INITIAL_IN_PERSON_CUTOVER !== "enabled") return { eligible: false, reason: "cutover-disabled" };
  if (flow?.flowKey !== "initial-in-person" || !CALENDAR_IDS.has(enrollment?.calendarId)) return { eligible: false, reason: "not-initial-in-person" };
  if (!["booked-internal", "confirmation", "day-before", "one-hour-sms", "starting-soon", "one-hour-internal"].includes(step?.template)) return { eligible: false, reason: "not-owned-step" };
  if (!EMAIL.test(clean(env.GARRETT_INTERNAL_EMAIL)) || !clean(env.GARRETT_INTERNAL_CONTACT_ID)) return { eligible: false, reason: "internal-recipient-not-configured" };
  return { eligible: true };
}

async function read(env, path) {
  const token = await getAccessToken(env);
  const response = await fetch(`${GHL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } });
  if (!response.ok) throw new Error(`GHL read ${response.status}`);
  return response.json();
}

export async function deliverInitialInPersonStep(env, step, enrollment, services = {}) {
  const readAppointment = services.read || read;
  const sendEmail = services.sendEmail || sendOwnedEmail;
  const sendSms = services.sendSms || ((message) => sendConversationMessage({ env }, message));
  const [appointmentData, contactData] = await Promise.all([
    readAppointment(env, `/calendars/events/appointments/${encodeURIComponent(enrollment.appointmentId)}`),
    readAppointment(env, `/contacts/${encodeURIComponent(enrollment.contactId)}`),
  ]);
  const appointment = appointmentData.appointment || appointmentData.event || appointmentData || {};
  const contact = contactData.contact || contactData || {};
  const name = clean(contact.firstName || contact.first_name || contact.name?.split(" ")[0]) || "there";
  const clientEmail = clean(contact.email || contact.emailAddress || contact.email_address);
  const calendar = clean(appointment.calendarName || appointment.calendar?.name) || "Amari Assessment — In Person";
  const when = appointmentTime(appointment.startTime || appointment.startAt || enrollment.startAt);
  const location = "662 8th Ave, San Francisco, CA 94118";
  const links = [
    clean(appointment.addToGoogleCalendar || appointment.add_to_google_calendar) && `Add to Google Calendar: ${clean(appointment.addToGoogleCalendar || appointment.add_to_google_calendar)}`,
    clean(appointment.addToIcalOutlook || appointment.add_to_ical_outlook) && `Add to iCal/Outlook: ${clean(appointment.addToIcalOutlook || appointment.add_to_ical_outlook)}`,
    clean(appointment.rescheduleLink || appointment.reschedule_link) && `Reschedule: ${clean(appointment.rescheduleLink || appointment.reschedule_link)}`,
    clean(appointment.cancellationLink || appointment.cancellation_link) && `Cancel: ${clean(appointment.cancellationLink || appointment.cancellation_link)}`,
  ].filter(Boolean).join("\n");
  const email = async (to, subject, text) => {
    if (!EMAIL.test(to)) return { success: false, error: "recipient email is unavailable" };
    return sendEmail(env, { to, subject, text });
  };
  if (step.template === "booked-internal") {
    return { recipient: clean(env.GARRETT_INTERNAL_EMAIL), ...(await email(clean(env.GARRETT_INTERNAL_EMAIL), `${name} booked a ${calendar}`, `Hi, Big Dog,\n\n${clean(contact.name) || name} booked a ${calendar} for ${when.date} at ${when.time}.\nStudio: ${location}`)) };
  }
  if (step.template === "confirmation") {
    return { recipient: clientEmail, ...(await email(clientEmail, "You're booked — here's what to expect", `Hi ${name},\n\nYour session with Garrett is confirmed:\n${calendar}\n${when.full}\n${location}\n\nWear something comfortable you can move in. That's all you need.\n\n${links}\n\nWe look forward to seeing you.\nThe Amari Method Team`)) };
  }
  if (step.template === "day-before") {
    return { recipient: clientEmail, ...(await email(clientEmail, `Your session on ${when.full}`, `Hi ${name},\n\nJust a heads up about your upcoming session:\n${calendar}\n${when.full}\n${location}\n\n${links}\n\nLooking forward to it.\nGarrett`)) };
  }
  if (step.template === "starting-soon") {
    return { recipient: clientEmail, ...(await email(clientEmail, `Your session at ${when.time}`, `Hi ${name},\n\nYour Amari Method session is at ${when.time}.\n${location}\n\nSee you soon.\nGarrett`)) };
  }
  if (step.template === "one-hour-sms") {
    return { recipient: enrollment.contactId, ...(await sendSms({ channel: "sms", contactId: enrollment.contactId, message: `Hi ${name}, just a friendly reminder — your appointment with Garrett is at ${when.time}. ${location}` })) };
  }
  if (step.template === "one-hour-internal") {
    const additionalInformation = clean(contact.additional_information) || customField(contact, "additional_information") || customField(contact, "5cEfs0e46quKY8J2HULr");
    return { recipient: clean(env.GARRETT_INTERNAL_CONTACT_ID), ...(await sendSms({ channel: "sms", contactId: clean(env.GARRETT_INTERNAL_CONTACT_ID), message: `${clean(contact.name) || name}'s ${calendar} appointment at ${when.time}. These were the specific issues this person wanted to address (if applicable): ${additionalInformation}` })) };
  }
  return { success: false, error: "unknown owned step" };
}
