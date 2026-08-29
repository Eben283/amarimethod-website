// Google Calendar implementation of the owned Staff appointment edge.
//
// The calendar and OAuth subject are explicit server configuration. Events
// contain only opaque owned identifiers in private extended properties. They
// never include a client attendee and every mutation pins sendUpdates=none, so
// Google cannot become an accidental customer-notification sender.

import { appointmentEndTime } from "./datetime.js";
import { getGoogleToken } from "./google-api.js";
import { policyForCalendarId, WORK_HOURS } from "./booking-slot-policy.js";
import { assertStaffCalendarAuthority } from "./staff-calendar-oauth.js";

const API = "https://www.googleapis.com/calendar/v3";
const PROVIDER = "google_calendar";

function clean(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function configured(context) {
  const calendarId = clean(context?.env?.STAFF_APPOINTMENT_GOOGLE_CALENDAR_ID, 240);
  const user = clean(context?.env?.STAFF_APPOINTMENT_GOOGLE_USER, 80);
  if (!calendarId || !user) {
    const error = new Error("Google appointment calendar authority is not configured.");
    error.code = "calendar_provider_unavailable";
    throw error;
  }
  return { calendarId, user };
}

async function request(context, user, path, options = {}) {
  const calendarId = clean(context?.env?.STAFF_APPOINTMENT_GOOGLE_CALENDAR_ID, 240);
  await assertStaffCalendarAuthority(context.env, user, calendarId);
  const token = await getGoogleToken(context, user);
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
}

function privateFields(event) {
  return event?.extendedProperties?.private || {};
}

function normalizeEvent(event, providerCalendarId, fallback = {}) {
  const owned = privateFields(event);
  const rawStatus = clean(event?.status, 40).toLowerCase();
  const status = rawStatus === "confirmed" || rawStatus === "cancelled" ? rawStatus : rawStatus || "unknown";
  return {
    id: clean(event?.id || fallback.id, 240),
    contactId: clean(owned.amariOwnedContactId || fallback.contactId, 160),
    calendarId: clean(owned.amariServiceCalendarId || fallback.calendarId, 160),
    providerCalendarId,
    serviceId: clean(owned.amariServiceId || fallback.serviceId, 160),
    title: clean(event?.summary || fallback.title) || "Session",
    appointmentStatus: status,
    status,
    startTime: event?.start?.dateTime || fallback.startTime || null,
    endTime: event?.end?.dateTime || fallback.endTime || null,
    timezone: event?.start?.timeZone || fallback.timezone || WORK_HOURS.timezone,
    location: event?.location || fallback.location || null,
    htmlLink: event?.htmlLink || null,
  };
}

async function responseJson(response, message) {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`${message} (${response.status}).`);
    error.status = response.status;
    error.detail = detail.slice(0, 500);
    throw error;
  }
  return response.json();
}

function eventsPath(calendarId, params) {
  return `/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
}

export function createGoogleStaffCalendarProvider(context, ownedContactId) {
  const authoritativeContactId = clean(ownedContactId, 160);
  if (!authoritativeContactId) throw new TypeError("Google calendar adapter requires owned contact identity");
  const { calendarId: providerCalendarId, user } = configured(context);

  async function listContactAppointments() {
    const params = new URLSearchParams({
      privateExtendedProperty: `amariOwnedContactId=${authoritativeContactId}`,
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "2500",
    });
    const response = await request(context, user, eventsPath(providerCalendarId, params));
    const data = await responseJson(response, "Could not load this person’s Google Calendar appointments");
    if (data.nextPageToken) throw new Error("Google Calendar contact read exceeded the exact bounded page.");
    return (data.items || []).map((event) => normalizeEvent(event, providerCalendarId));
  }

  async function getAppointment(appointmentId, _contactId, fallback = {}) {
    const id = clean(appointmentId, 240);
    const response = await request(
      context,
      user,
      `/calendars/${encodeURIComponent(providerCalendarId)}/events/${encodeURIComponent(id)}`,
    );
    if (response.status === 404 || response.status === 410) {
      return normalizeEvent({ id, status: "cancelled" }, providerCalendarId, fallback);
    }
    return normalizeEvent(
      await responseJson(response, "Could not read back the Google Calendar appointment"),
      providerCalendarId,
      fallback,
    );
  }

  async function listSchedule(start, end) {
    const params = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      orderBy: "startTime",
      maxResults: "2500",
    });
    const response = await request(context, user, eventsPath(providerCalendarId, params));
    const data = await responseJson(response, "Could not load Garrett’s Google Calendar schedule");
    if (data.nextPageToken) throw new Error("Google Calendar schedule read exceeded the exact bounded page.");
    return (data.items || []).map((event) => normalizeEvent(event, providerCalendarId));
  }

  async function cancelAppointment(appointment) {
    const id = clean(appointment?.id, 240);
    if (!id) throw new TypeError("Google Calendar appointment identity required");
    const response = await request(
      context,
      user,
      `/calendars/${encodeURIComponent(providerCalendarId)}/events/${encodeURIComponent(id)}?sendUpdates=none`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      await responseJson(response, "Google Calendar cancellation failed");
    }
  }

  async function create({ booking, startTime, timezone, onCreated, title }) {
    if (!booking?.serviceId || !policyForCalendarId(booking.calendarId)) {
      throw new Error("The appointment is missing governed owned service identity.");
    }
    const body = {
      summary: clean(title || booking.title) || "Amari Method Session",
      start: { dateTime: startTime, timeZone: timezone || WORK_HOURS.timezone },
      end: {
        dateTime: appointmentEndTime(startTime, booking.durationMinutes),
        timeZone: timezone || WORK_HOURS.timezone,
      },
      transparency: "opaque",
      visibility: "private",
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: false,
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: {
        private: {
          amariAuthorityVersion: "1",
          amariOwnedContactId: authoritativeContactId,
          amariServiceId: clean(booking.serviceId, 160),
          amariServiceCalendarId: clean(booking.calendarId, 160),
        },
      },
    };
    let createdId = null;
    try {
      const response = await request(
        context,
        user,
        eventsPath(providerCalendarId, new URLSearchParams({ sendUpdates: "none", conferenceDataVersion: "0" })),
        { method: "POST", body: JSON.stringify(body) },
      );
      const created = await responseJson(response, "Google Calendar appointment creation failed");
      createdId = clean(created?.id, 240);
      if (!createdId) throw new Error("Google Calendar did not return an appointment identity.");
      await onCreated?.(createdId, { provider: PROVIDER, providerCalendarId });
      const readback = await getAppointment(createdId, authoritativeContactId);
      if (readback.contactId !== authoritativeContactId ||
          readback.serviceId !== booking.serviceId ||
          readback.calendarId !== booking.calendarId ||
          Date.parse(readback.startTime || "") !== Date.parse(startTime) ||
          readback.status !== "confirmed") {
        const error = new Error("Google Calendar appointment readback did not match owned intent.");
        error.code = "provider_readback_mismatch";
        throw error;
      }
      return readback;
    } catch (error) {
      error.phase = createdId ? "readback" : "create";
      error.appointmentId = createdId;
      if (createdId) {
        const cleanup = await request(
          context,
          user,
          `/calendars/${encodeURIComponent(providerCalendarId)}/events/${encodeURIComponent(createdId)}?sendUpdates=none`,
          { method: "DELETE" },
        ).catch(() => null);
        error.cleanupStatus = cleanup?.status || 0;
      }
      throw error;
    }
  }

  return Object.freeze({
    provider: PROVIDER,
    providerCalendarIdFor: () => providerCalendarId,
    listContactAppointments,
    getAppointment,
    listSchedule,
    cancelAppointment,
    createAppointment: (input) => create(input),
    createReplacement: ({ original, ...input }) => {
      const serviceCalendarId = clean(original?.calendarId || original?.calendar_id, 160);
      const policy = policyForCalendarId(serviceCalendarId);
      const serviceId = clean(original?.serviceId, 160);
      if (!policy || !serviceId) throw new Error("The original appointment is missing governed owned service identity.");
      return create({
        ...input,
        title: clean(original?.title) || policy.label,
        booking: {
          serviceId,
          calendarId: serviceCalendarId,
          durationMinutes: policy.durationMinutes,
          title: clean(original?.title) || policy.label,
        },
      });
    },
  });
}
