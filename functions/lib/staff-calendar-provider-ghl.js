// Temporary GHL calendar compatibility adapter.
//
// Staff's command/domain layer owns actor, person, service, policy,
// idempotency, compensation, and durable evidence. This module is the only
// place in that path allowed to translate those owned decisions into GHL
// contact/calendar reads and writes, so removing GHL does not require changing
// the command contract or browser payload.

import { ghlFetch } from "./ghl.js";
import { appointmentEndTime } from "./datetime.js";
import { fetchGarrettScheduleEvents } from "./app-owned-buffer.js";
import { policyForCalendarId, WORK_HOURS } from "./booking-slot-policy.js";
import { createConfirmedAppointment } from "./ghl-appointment-handoff.js";

const BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

function clean(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function listAppointments(context, contactId) {
  const response = await ghlFetch(context, `${BASE}/contacts/${encodeURIComponent(contactId)}/appointments`);
  if (!response.ok) throw Object.assign(new Error("Could not load this person’s appointments."), { status: response.status });
  const data = await response.json();
  return data.appointments || data.events || [];
}

async function cancelAppointment(context, appointment) {
  const title = clean(appointment?.title) || "Session";
  const response = await ghlFetch(context, `${BASE}/calendars/events/appointments/${encodeURIComponent(appointment.id)}`, {
    method: "PUT",
    body: JSON.stringify({ title, appointmentStatus: "cancelled" }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(`Calendar cancellation failed (${response.status}).`), { status: response.status, detail });
  }
}

async function contactFor(context, contactId, action) {
  const response = await ghlFetch(context, `${BASE}/contacts/${encodeURIComponent(contactId)}`);
  if (!response.ok) throw new Error(`Could not load the person for this ${action}.`);
  const data = await response.json();
  return data.contact || data;
}

function appointmentPayload({ contact, contactId, calendarId, startTime, durationMinutes, timezone, title, toNotify }) {
  return {
    calendarId,
    locationId: LOCATION_ID,
    contactId,
    startTime,
    endTime: appointmentEndTime(startTime, durationMinutes),
    selectedTimezone: timezone || WORK_HOURS.timezone,
    title,
    toNotify,
    ignoreDateRange: false,
    firstName: contact.firstName || contact.first_name || "",
    lastName: contact.lastName || contact.last_name || "",
    email: contact.email || "",
    phone: contact.phone || "",
  };
}

export function createGhlStaffCalendarProvider(context, providerContactId) {
  const authoritativeContactId = clean(providerContactId, 120);
  if (!authoritativeContactId) throw new TypeError("GHL calendar adapter requires provider contact identity");

  return Object.freeze({
    // Intentionally ignore command-supplied contact IDs. The owned CRM
    // crosswalk selected this exact provider identity before adapter creation.
    listContactAppointments: () => listAppointments(context, authoritativeContactId),
    listSchedule: (start, end) => fetchGarrettScheduleEvents(context, start, end),
    cancelAppointment: (appointment) => cancelAppointment(context, appointment),
    async createAppointment({ booking, startTime, timezone, onCreated }) {
      if (!booking || !policyForCalendarId(booking.calendarId)) {
        throw new Error("The appointment is missing governed calendar identity.");
      }
      const contact = await contactFor(context, authoritativeContactId, "appointment");
      return createConfirmedAppointment({
        endpoint: `${BASE}/calendars/events/appointments`,
        request: (url, options) => ghlFetch(context, url, options),
        onCreated,
        payload: appointmentPayload({
          contact,
          contactId: authoritativeContactId,
          calendarId: booking.calendarId,
          startTime,
          durationMinutes: booking.durationMinutes,
          timezone,
          title: booking.title,
          toNotify: true,
        }),
      });
    },
    async createReplacement({ original, startTime, timezone, onCreated }) {
      const calendarId = clean(original?.calendarId || original?.calendar_id, 120);
      const policy = policyForCalendarId(calendarId);
      if (!policy) throw new Error("The original appointment is missing governed calendar identity.");
      const contact = await contactFor(context, authoritativeContactId, "reschedule");
      return createConfirmedAppointment({
        endpoint: `${BASE}/calendars/events/appointments`,
        request: (url, options) => ghlFetch(context, url, options),
        onCreated,
        payload: appointmentPayload({
          contact,
          contactId: authoritativeContactId,
          calendarId,
          startTime,
          durationMinutes: policy.durationMinutes,
          timezone,
          title: clean(original?.title) || policy.label,
          toNotify: false,
        }),
      });
    },
  });
}
