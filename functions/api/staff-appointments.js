// Staff appointment management: internal availability, new scheduling,
// rescheduling, and cancellation. Provider identity/status/calendar fields are
// always derived server-side from the governed service or exact appointment.

import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import { normalizeGhlTimestamp } from "../lib/datetime.js";
import { policyForCalendarId, WORK_HOURS } from "../lib/booking-slot-policy.js";
import { createAppointmentCommandStore } from "../lib/appointment-command-store.js";
import {
  claimBookingOperation,
  checkpointBookingAppointment,
  clearBookingAppointmentCheckpoint,
  completeBookingOperation,
  failBookingOperation,
} from "../lib/booking-operations.js";
import { listStaffBookTypes, resolveStaffBookType } from "../lib/staff-book-calendars.js";
import { internalAvailability, manageAppointmentCommand, scheduleAppointmentCommand } from "../lib/staff-appointment-manage.js";
import { emitPathHop } from "../lib/ops-path-emit.js";
import { recordOpsError } from "../lib/ops-alert.js";
import { requireProviderContactIdentity, resolveOwnedContactIdentity } from "../lib/staff-owned-contact-identity.js";
import { createGhlStaffCalendarProvider } from "../lib/staff-calendar-provider-ghl.js";
import { createOwnedAppointmentScheduleStore } from "../lib/staff-owned-appointment-store.js";
import { requireProviderAppointmentIdentity, resolveStaffOwnedAppointmentIdentity } from "../lib/staff-owned-appointment-identity.js";

const METHODS = "POST, OPTIONS";
const FORBIDDEN_FIELDS = ["calendarId", "title", "appointmentStatus", "status", "replacementAppointmentId", "timezone", "actor", "user"];

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function clean(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function exactAppointment(appointments, appointmentId) {
  return (appointments || []).find((item) => String(item?.id || "") === appointmentId) || null;
}

function appointmentStatus(appointment) {
  return String(appointment?.appointmentStatus || appointment?.status || "").toLowerCase();
}

function scheduleStore(db, { actor, contactId, sessionType, idempotencyKey, startTime, booking }) {
  const opKey = `staff-schedule:${actor.toLowerCase()}:${idempotencyKey}`;
  return Object.freeze({
    claim: () => claimBookingOperation(db, {
      opKey,
      kind: `staff_schedule:${sessionType}`,
      contactId,
      calendarId: booking.calendarId,
      startTime,
    }),
    checkpointAppointment: (appointmentId) => checkpointBookingAppointment(db, opKey, appointmentId),
    clearAppointment: (appointmentId) => clearBookingAppointmentCheckpoint(db, opKey, appointmentId),
    complete: (result) => completeBookingOperation(db, opKey, result),
    fail: (error, options) => failBookingOperation(db, opKey, error?.message || error, options),
  });
}

function identityFailure(error, headers) {
  const status = Number(error?.status);
  return json({
    error: error?.message || "Owned CRM identity is unavailable.",
    code: error?.code || "owned_identity_unavailable",
  }, [400, 404, 409, 503].includes(status) ? status : 503, headers);
}

function isIdentityError(error) {
  const code = String(error?.code || "");
  return code.startsWith("owned_") || code.startsWith("provider_") || code === "contact_reference_required";
}

async function providerIdentity(context, reference) {
  const identity = await resolveOwnedContactIdentity(context, reference);
  return Object.freeze({
    ...identity,
    providerContactId: requireProviderContactIdentity(identity),
  });
}

async function providerAppointmentIdentity(context, reference, contactIdentity) {
  const identity = await resolveStaffOwnedAppointmentIdentity(context, reference);
  if (identity.ownedContactId !== contactIdentity.ownedContactId) {
    const error = new Error("Appointment does not belong to this owned person.");
    error.code = "owned_appointment_contact_mismatch";
    error.status = 409;
    throw error;
  }
  const provider = requireProviderAppointmentIdentity(identity);
  if (provider.contactId !== contactIdentity.providerContactId) {
    const error = new Error("Appointment provider identity does not match this person.");
    error.code = "owned_appointment_provider_mismatch";
    error.status = 409;
    throw error;
  }
  return Object.freeze({ ...identity, ...provider });
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), METHODS) });
}

export async function onRequestPost(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), METHODS),
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  };
  const auth = await requireStaffAuth(context, headers);
  if (auth.error) return auth.error;
  const actor = auth.payload?.user;
  if (!new Set(["Eben", "Garrett"]).has(actor)) return json({ error: "Recognized Staff identity required." }, 403, headers);

  const parsed = await parseJsonBody(context.request, headers);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (FORBIDDEN_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    return json({ error: "Appointment identity and status are controlled by the server." }, 400, headers);
  }
  const action = clean(body.action, 30);
  const contactId = clean(body.contactId, 100);
  const appointmentId = clean(body.appointmentId, 100);

  if (action === "list-types") return json({ types: listStaffBookTypes() }, 200, headers);

  if (action === "availability") {
    const startDate = clean(body.startDate, 10);
    const endDate = clean(body.endDate, 10);
    if (!validDate(startDate) || !validDate(endDate)) return json({ error: "Choose a valid date range." }, 400, headers);
    try {
      let original = null;
      let booking = null;
      let calendarId = "";
      let identity;
      let appointmentIdentity = null;
      if (appointmentId) {
        if (!contactId) return json({ error: "Choose a person and appointment." }, 400, headers);
        identity = await providerIdentity(context, contactId);
        appointmentIdentity = await providerAppointmentIdentity(context, appointmentId, identity);
        const appointments = await createGhlStaffCalendarProvider(context, identity.providerContactId).listContactAppointments();
        original = exactAppointment(appointments, appointmentIdentity.appointmentId);
        if (!original) return json({ error: "Appointment not found for this person." }, 404, headers);
        if (!["new", "confirmed"].includes(appointmentStatus(original))) {
          return json({ error: `This appointment is already ${appointmentStatus(original) || "not manageable"}.` }, 409, headers);
        }
        calendarId = clean(original.calendarId || original.calendar_id, 100);
      } else {
        if (!contactId) return json({ error: "Choose a person." }, 400, headers);
        identity = await providerIdentity(context, contactId);
        booking = resolveStaffBookType(clean(body.sessionType, 64));
        if (!booking) return json({ error: "Choose an appointment type." }, 400, headers);
        calendarId = booking.calendarId;
      }
      if (!policyForCalendarId(calendarId)) return json({ error: "This calendar is not yet governed for Staff scheduling." }, 409, headers);
      const start = Date.parse(normalizeGhlTimestamp(`${startDate}T00:00:00`));
      const end = Date.parse(normalizeGhlTimestamp(`${endDate}T23:59:59`));
      const events = await createGhlStaffCalendarProvider(context, identity.providerContactId).listSchedule(start, end);
      return json({
        appointment: original ? {
          id: appointmentIdentity?.ownedAppointmentId || appointmentId,
          title: original.title || "Session",
          startTime: original.startTime || original.start_time,
          calendarName: original.calendarName || "",
        } : null,
        service: booking ? { id: clean(body.sessionType, 64), label: booking.label, durationMinutes: booking.durationMinutes } : null,
        slots: internalAvailability({
          calendarId, startDate, endDate, events,
          excludeAppointmentId: original?.id || appointmentId,
        }),
        timezone: WORK_HOURS.timezone,
        source: "garrett_internal_schedule",
        publicRestrictionsApplied: false,
        guidance: "All collision-free Staff times are shown; public booking filters are not applied.",
      }, 200, headers);
    } catch (error) {
      console.error("[staff-appointments] availability failed", error);
      if (isIdentityError(error)) {
        return identityFailure(error, headers);
      }
      return json({ error: error?.message || "Could not load Garrett’s internal availability." }, 500, headers);
    }
  }

  if (action === "schedule") {
    const sessionType = clean(body.sessionType, 64);
    const booking = resolveStaffBookType(sessionType);
    const idempotencyKey = clean(body.idempotencyKey, 160);
    const startTime = clean(body.startTime, 100);
    if (!contactId) return json({ error: "Choose a person." }, 400, headers);
    if (!booking) return json({ error: "Choose an appointment type." }, 400, headers);
    if (idempotencyKey.length < 8) return json({ error: "A valid action key is required." }, 400, headers);
    if (!startTime) return json({ error: "Choose a time." }, 400, headers);
    try {
      const identity = await providerIdentity(context, contactId);
      const ownedAuthority = Boolean(booking.serviceId);
      if (!ownedAuthority && !context.env.ATTEND_DB) {
        return json({ error: "Appointment scheduling is temporarily unavailable; no calendar change was made." }, 500, headers);
      }
      const store = ownedAuthority
        ? createOwnedAppointmentScheduleStore(context, {
          actor,
          contactId: identity.ownedContactId,
          sessionType,
          idempotencyKey,
          startTime,
          timezone: WORK_HOURS.timezone,
          booking,
        })
        : scheduleStore(context.env.ATTEND_DB, { actor, contactId: identity.ownedContactId, sessionType, idempotencyKey, startTime, booking });
      const result = await scheduleAppointmentCommand({
        actor,
        contactId: identity.ownedContactId,
        sessionType,
        booking,
        idempotencyKey,
        startTime,
        timezone: WORK_HOURS.timezone,
        store,
        provider: createGhlStaffCalendarProvider(context, identity.providerContactId),
      });
      context.waitUntil?.(emitPathHop(context.env, {
        pathId: "staff_appointment_manage",
        hopId: "schedule",
        outcome: "ok",
        summary: "Staff scheduled appointment",
        source: "staff-appointments",
        contactId: identity.ownedContactId,
        correlationId: idempotencyKey,
      }));
      return json(result, 200, headers);
    } catch (error) {
      console.error("[staff-appointments] schedule failed", error);
      context.waitUntil?.(recordOpsError(context.env, "staff-appointments", "Staff appointment schedule failed", {
        actor, action, contactId, sessionType, code: error?.code || "unknown",
      }));
      if (isIdentityError(error)) {
        return identityFailure(error, headers);
      }
      const status = ["in_progress", "conflict", "slot_unavailable"].includes(error?.code) ? 409
        : error?.manualReview ? 409 : 422;
      return json({ error: error?.message || "Appointment scheduling failed.", code: error?.code || "appointment_schedule_failed" }, status, headers);
    }
  }

  if (!contactId || !appointmentId) return json({ error: "Choose a person and appointment." }, 400, headers);
  if (!["cancel", "reschedule"].includes(action)) return json({ error: "Choose cancel or reschedule." }, 400, headers);
  const idempotencyKey = clean(body.idempotencyKey, 160);
  if (idempotencyKey.length < 8) return json({ error: "A valid action key is required." }, 400, headers);
  const startTime = clean(body.startTime, 100);
  if (action === "reschedule" && !startTime) return json({ error: "Choose a new time." }, 400, headers);

  let store;
  try {
    store = createAppointmentCommandStore(context.env.ATTEND_DB || null);
  } catch (error) {
    return json({ error: "Appointment changes are temporarily unavailable; no calendar change was made." }, 500, headers);
  }
  try {
    const identity = await providerIdentity(context, contactId);
    const appointmentIdentity = await providerAppointmentIdentity(context, appointmentId, identity);
    const result = await manageAppointmentCommand({
      actor,
      action,
      contactId: identity.ownedContactId,
      appointmentId: appointmentIdentity.ownedAppointmentId,
      providerAppointmentId: appointmentIdentity.appointmentId,
      idempotencyKey,
      startTime,
      timezone: WORK_HOURS.timezone,
      store,
      provider: createGhlStaffCalendarProvider(context, identity.providerContactId),
    });
    context.waitUntil?.(emitPathHop(context.env, {
      pathId: "staff_appointment_manage",
      hopId: action,
      outcome: "ok",
      summary: action === "cancel" ? "Staff cancelled appointment" : "Staff rescheduled appointment",
      source: "staff-appointments",
      contactId: identity.ownedContactId,
      correlationId: idempotencyKey,
    }));
    return json(result, 200, headers);
  } catch (error) {
    console.error("[staff-appointments] command failed", error);
    context.waitUntil?.(recordOpsError(context.env, "staff-appointments", "Staff appointment change failed", {
      actor, action, contactId, appointmentId, code: error?.code || "unknown",
    }));
    if (isIdentityError(error)) {
      return identityFailure(error, headers);
    }
    const status = error?.code === "appointment_not_found" ? 404
      : ["in_progress", "conflict", "appointment_not_manageable", "appointment_not_future", "slot_unavailable"].includes(error?.code) ? 409
        : error?.manualReview ? 409 : 422;
    return json({ error: error?.message || "Appointment change failed.", code: error?.code || "appointment_change_failed" }, status, headers);
  }
}
