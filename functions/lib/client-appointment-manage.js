import { appointmentManageIdempotencyKey, verifyAppointmentManageToken } from "./appointment-manage-token.js";
import { applyGarrettSchedulePreference } from "./app-owned-buffer.js";
import { policyForCalendarId, WORK_HOURS } from "./booking-slot-policy.js";
import { applyLookBusy } from "./look-busy.js";
import { internalAvailability, manageAppointmentCommand } from "./staff-appointment-manage.js";
import { createStaffCalendarProvider } from "./staff-calendar-provider.js";
import { requireProviderAppointmentIdentity, resolveStaffOwnedAppointmentIdentity } from "./staff-owned-appointment-identity.js";
import { createOwnedAppointmentManageStore } from "./staff-owned-appointment-store.js";

const CHANGEABLE = new Set(["booked", "confirmed"]);
const PROVIDER_CHANGEABLE = new Set(["new", "confirmed"]);
const DAY_MS = 86_400_000;

function fail(message, code, status = 409) {
  throw Object.assign(new Error(message), { code, status });
}

function clean(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function providerStatus(appointment) {
  return clean(appointment?.appointmentStatus || appointment?.status, 40).toLowerCase();
}

function dateKey(ms, timezone = WORK_HOURS.timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function exactProviderAppointment(provider, identity) {
  if (typeof provider.getAppointment === "function") {
    return provider.getAppointment(identity.providerAppointmentId, identity.ownedContactId, {
      id: identity.providerAppointmentId,
      contactId: identity.ownedContactId,
      calendarId: identity.providerCalendarId,
      serviceId: identity.serviceId,
      title: identity.serviceName,
      startTime: identity.startsAt,
      endTime: identity.endsAt,
      timezone: identity.timezone,
      location: identity.meetingLocation,
    });
  }
  const appointments = await provider.listContactAppointments(identity.providerContactId);
  return (appointments || []).find((appointment) =>
    clean(appointment?.id) === identity.providerAppointmentId,
  ) || null;
}

export async function resolveClientAppointmentManageContext(context, token, capability, nowMs = Date.now()) {
  const secret = context?.env?.APPOINTMENT_MANAGE_LINK_SECRET;
  if (clean(secret).length < 32) {
    fail("Appointment management is temporarily unavailable.", "appointment_manage_secret_unavailable", 503);
  }
  let claims;
  try {
    claims = await verifyAppointmentManageToken(secret, token, { capability, nowMs });
  } catch {
    fail("This appointment link is invalid or has expired.", "appointment_manage_link_invalid", 401);
  }
  const identity = await resolveStaffOwnedAppointmentIdentity(context, claims.appointmentId);
  if (identity.ownedAppointmentId !== claims.appointmentId || identity.ownedContactId !== claims.contactId) {
    fail("This appointment link does not match the owned appointment.", "appointment_manage_identity_mismatch");
  }
  if (Number(identity.revision) !== claims.revision) {
    fail("This appointment has changed since this link was issued.", "appointment_manage_link_stale");
  }
  if (identity.serviceId !== "partner-initial") {
    fail("This appointment cannot be changed from this link.", "appointment_manage_service_forbidden", 403);
  }
  if (identity.authority !== "owned" || !new Set(["synced", "not_required"]).has(identity.providerSyncState)) {
    fail("This appointment is not ready for client changes.", "appointment_manage_authority_unavailable");
  }
  if (!CHANGEABLE.has(clean(identity.status, 40).toLowerCase()) || Date.parse(identity.startsAt || "") <= nowMs) {
    fail("This appointment is no longer changeable.", "appointment_not_manageable");
  }
  const providerIdentity = requireProviderAppointmentIdentity(identity);
  const provider = createStaffCalendarProvider(context, identity, providerIdentity.provider);
  const appointment = await exactProviderAppointment(provider, identity);
  if (!appointment || !PROVIDER_CHANGEABLE.has(providerStatus(appointment))) {
    fail("The calendar could not confirm a changeable appointment.", "provider_appointment_not_manageable");
  }
  if (clean(appointment.id) !== identity.providerAppointmentId) {
    fail("The calendar appointment identity did not match.", "provider_appointment_identity_mismatch");
  }
  const providerStart = Date.parse(appointment.startTime || appointment.start_time || "");
  const ownedStart = Date.parse(identity.startsAt || "");
  if (!Number.isFinite(providerStart) || !Number.isFinite(ownedStart) || providerStart !== ownedStart) {
    fail("The calendar time has changed outside the owned appointment.", "provider_appointment_time_drift");
  }
  const appointmentService = clean(appointment.serviceId, 160);
  if (appointmentService && appointmentService !== identity.serviceId) {
    fail("The calendar service did not match the owned appointment.", "provider_appointment_service_mismatch");
  }
  if (identity.provider === "ghl" &&
      clean(appointment.calendarId || appointment.calendar_id, 160) !== identity.providerCalendarId) {
    fail("The calendar identity did not match the owned appointment.", "provider_appointment_calendar_mismatch");
  }
  return Object.freeze({ claims, identity: Object.freeze({ ...identity, ...providerIdentity }), provider, appointment });
}

export async function clientAppointmentAvailability(resolved, nowMs = Date.now(), horizonDays = 21) {
  const { identity, provider, appointment } = resolved;
  const calendarId = clean(appointment.calendarId || appointment.calendar_id || identity.providerCalendarId, 160);
  const policy = policyForCalendarId(calendarId);
  if (!policy) fail("This appointment calendar is not governed for rescheduling.", "appointment_calendar_ungoverned");
  const timezone = clean(identity.timezone, 100) || WORK_HOURS.timezone;
  const startDate = dateKey(nowMs, timezone);
  const endDate = dateKey(nowMs + Math.min(Math.max(Number(horizonDays), 1), 32) * DAY_MS, timezone);
  const events = await provider.listSchedule(
    Date.parse(`${startDate}T00:00:00-08:00`) - 12 * 60 * 60 * 1000,
    Date.parse(`${endDate}T23:59:59-07:00`) + 12 * 60 * 60 * 1000,
  );
  const slots = internalAvailability({
    calendarId,
    startDate,
    endDate,
    events,
    excludeAppointmentId: identity.providerAppointmentId,
    now: nowMs,
    intervalMinutes: policy.intervalMinutes,
  });
  return Object.freeze({
    calendarId,
    timezone,
    slots: applyLookBusy(applyGarrettSchedulePreference(slots, events), { calendarId, asOfDate: startDate }),
  });
}

export async function executeClientAppointmentManage(context, token, action, startTime = "", nowMs = Date.now()) {
  if (!new Set(["cancel", "reschedule"]).has(action)) {
    fail("Choose cancel or reschedule.", "appointment_manage_action_invalid", 400);
  }
  const resolved = await resolveClientAppointmentManageContext(context, token, action, nowMs);
  const idempotencyKey = await appointmentManageIdempotencyKey(token, action, startTime);
  const { identity, provider } = resolved;
  const store = createOwnedAppointmentManageStore(context, {
    actor: "Client",
    action,
    contactId: identity.ownedContactId,
    appointmentId: identity.ownedAppointmentId,
    provider: identity.provider,
    providerCalendarId: identity.providerCalendarId,
    timezone: identity.timezone,
  });
  return manageAppointmentCommand({
    actor: "Client",
    action,
    contactId: identity.ownedContactId,
    appointmentId: identity.ownedAppointmentId,
    providerAppointmentId: identity.providerAppointmentId,
    idempotencyKey,
    startTime,
    timezone: identity.timezone,
    store,
    provider,
    now: nowMs,
  });
}
