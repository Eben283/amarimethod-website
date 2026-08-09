// The first owned-delivery proof is intentionally narrower than a cutover: it can send only the
// Assessment confirmation email, only for one explicitly configured test contact, and only to a
// separately configured inbox controlled by Amari. All ordinary contacts remain shadow-only.

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const ASSESSMENT_CALENDAR_ID = "EM6vB2mq7EAdGCbUb3j1";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function text(value) {
  return String(value || "").trim();
}

export function assessmentTestEligibility(env, flow, step, enrollment) {
  if (env?.ASSESSMENT_TEST_DELIVERY !== "enabled") return { eligible: false, reason: "test-delivery-disabled" };
  if (flow?.flowKey !== "initial-in-person" || enrollment?.calendarId !== ASSESSMENT_CALENDAR_ID) return { eligible: false, reason: "not-assessment-confirmation" };
  if (step?.type !== "email" || step?.template !== "confirmation") return { eligible: false, reason: "not-confirmation-email" };
  if (!env.ASSESSMENT_TEST_CONTACT_ID || enrollment.contactId !== env.ASSESSMENT_TEST_CONTACT_ID) return { eligible: false, reason: "contact-not-allowlisted" };
  if (!EMAIL.test(text(env.ASSESSMENT_TEST_RECIPIENT))) return { eligible: false, reason: "test-recipient-not-configured" };
  return { eligible: true, recipient: text(env.ASSESSMENT_TEST_RECIPIENT) };
}

// This is intentionally shipped disabled. A real cutover must separately make GHL bypass only
// its matching client-confirmation step; enabling this flag before that creates duplicate mail.
export function assessmentCutoverEligibility(env, flow, step, enrollment) {
  if (env?.ASSESSMENT_CONFIRMATION_CUTOVER !== "enabled") return { eligible: false, reason: "cutover-disabled" };
  if (flow?.flowKey !== "initial-in-person" || enrollment?.calendarId !== ASSESSMENT_CALENDAR_ID) return { eligible: false, reason: "not-assessment-confirmation" };
  if (step?.type !== "email" || step?.template !== "confirmation") return { eligible: false, reason: "not-confirmation-email" };
  return { eligible: true };
}

async function ghlGet(env, path) {
  const token = await getAccessToken(env);
  const response = await fetch(`${GHL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } });
  if (!response.ok) throw new Error(`GHL read ${response.status}`);
  return response.json();
}

function appointmentMoment(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "your scheduled time";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

/** Render the source-verified GHL confirmation into an owned transactional message. */
export async function renderAssessmentConfirmation(env, enrollment) {
  const [appointmentData, contactData] = await Promise.all([
    ghlGet(env, `/calendars/events/appointments/${encodeURIComponent(enrollment.appointmentId)}`),
    ghlGet(env, `/contacts/${encodeURIComponent(enrollment.contactId)}`),
  ]);
  const appointment = appointmentData.appointment || appointmentData.event || appointmentData || {};
  const contact = contactData.contact || contactData || {};
  const firstName = text(contact.firstName || contact.first_name || contact.name?.split(" ")[0]) || "there";
  const calendarName = text(appointment.calendarName || appointment.calendar?.name) || "Amari Assessment — In Person";
  const when = appointmentMoment(appointment.startTime || appointment.startAt || enrollment.startAt);
  const reschedule = text(appointment.rescheduleLink || appointment.reschedule_link);
  const cancel = text(appointment.cancellationLink || appointment.cancellation_link);
  const calendar = text(appointment.addToGoogleCalendar || appointment.add_to_google_calendar);
  const ical = text(appointment.addToIcalOutlook || appointment.add_to_ical_outlook);
  const links = [
    calendar && `<p><a href="${escapeHtml(calendar)}">Add to Google Calendar</a>${ical ? ` · <a href="${escapeHtml(ical)}">Add to iCal/Outlook</a>` : ""}</p>`,
    (reschedule || cancel) && `<p>If something came up: ${reschedule ? `<a href="${escapeHtml(reschedule)}">Reschedule</a>` : ""}${reschedule && cancel ? " · " : ""}${cancel ? `<a href="${escapeHtml(cancel)}">Cancel</a>` : ""}</p>`,
  ].filter(Boolean).join("");
  const html = `<p>Hi ${escapeHtml(firstName)},</p><p>Your session with Garrett is confirmed:</p><p><strong>${escapeHtml(calendarName)}</strong><br>${escapeHtml(when)}<br>662 8th Ave, San Francisco, CA 94118</p><p>Wear something comfortable you can move in. That’s all you need.</p>${links}<p>We look forward to seeing you.<br>The Amari Method Team</p>`;
  const plainLinks = [calendar && `Add to Google Calendar: ${calendar}`, ical && `Add to iCal/Outlook: ${ical}`, reschedule && `Reschedule: ${reschedule}`, cancel && `Cancel: ${cancel}`].filter(Boolean).join("\n");
  return {
    recipient: text(contact.email || contact.emailAddress || contact.email_address),
    subject: "You're booked — here's what to expect",
    html,
    text: `Hi ${firstName},\n\nYour session with Garrett is confirmed:\n${calendarName}\n${when}\n662 8th Ave, San Francisco, CA 94118\n\nWear something comfortable you can move in. That's all you need.\n\n${plainLinks}\n\nWe look forward to seeing you.\nThe Amari Method Team`,
  };
}
