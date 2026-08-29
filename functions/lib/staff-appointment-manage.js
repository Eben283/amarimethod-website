import { normalizeGhlTimestamp } from "./datetime.js";
import { slotRespectsAppBuffer } from "./app-owned-buffer.js";
import { WORK_HOURS, policyForCalendarId } from "./booking-slot-policy.js";

const INTERNAL_START_INTERVAL_MINUTES = 15;
const DAY_MS = 86_400_000;

function dateEpoch(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return NaN;
  return Date.parse(`${date}T00:00:00Z`);
}

function minutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function dateString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function weekday(date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .toLowerCase();
}

function wallClock(date, minuteOfDay) {
  const hour = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const minute = String(minuteOfDay % 60).padStart(2, "0");
  return normalizeGhlTimestamp(`${date}T${hour}:${minute}:00`);
}

/**
 * Garrett's internal Staff availability.
 *
 * Public calendars may thin, cluster, or hide otherwise-free starts. Staff is
 * allowed to use every 15-minute start inside Garrett's owned work schedule,
 * while the real practitioner calendar and Amari turnover buffers remain the
 * authority for collisions. No public show-layer preference is applied here.
 */
export function internalAvailability({ calendarId, startDate, endDate, events = [], excludeAppointmentId = null, now = Date.now() }) {
  const policy = policyForCalendarId(calendarId);
  const start = dateEpoch(startDate);
  const end = dateEpoch(endDate);
  if (!policy || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 32 * DAY_MS) {
    throw new TypeError("valid governed calendar and date range required");
  }

  const open = minutes(WORK_HOURS.firstSessionStart);
  const last = minutes(WORK_HOURS.lastSessionStart);
  const blocking = (events || []).filter((event) => String(event?.id || "") !== String(excludeAppointmentId || ""));
  const slots = [];

  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    const date = dateString(cursor);
    if (!WORK_HOURS.weekdays.includes(weekday(date))) continue;
    for (let at = open; at <= last; at += INTERNAL_START_INTERVAL_MINUTES) {
      const datetime = wallClock(date, at);
      if (Date.parse(datetime) <= Number(now)) continue;
      if (!slotRespectsAppBuffer(datetime, calendarId, blocking)) continue;
      slots.push({
        date,
        hour: Math.floor(at / 60),
        minute: at % 60,
        datetime,
        source: "garrett_internal_schedule",
      });
    }
  }
  return slots;
}

const MANAGEABLE_STATUSES = new Set(["new", "confirmed"]);

function clean(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeStatus(appointment) {
  return String(appointment?.appointmentStatus || appointment?.status || "").toLowerCase();
}

function appointmentStart(appointment) {
  return Date.parse(appointment?.startTime || appointment?.start_time || "");
}

function assertCommandInput(input) {
  if (!new Set(["Eben", "Garrett"]).has(input.actor)) throw new TypeError("recognized Staff actor required");
  if (!new Set(["cancel", "reschedule"]).has(input.action)) throw new TypeError("valid appointment action required");
  if (!clean(input.contactId, 100) || !clean(input.appointmentId, 100) || !clean(input.idempotencyKey, 160)) {
    throw new TypeError("complete appointment command identity required");
  }
}

async function loadOriginal(provider, contactId, appointmentId) {
  const appointments = await provider.listContactAppointments(contactId);
  return (appointments || []).find((appointment) => String(appointment?.id || "") === appointmentId) || null;
}

/**
 * One Staff command boundary for cancellation and rescheduling. Provider and
 * durable store are injected so the domain behavior stays testable and the UI
 * never controls provider identity or status transitions.
 */
export async function manageAppointmentCommand(input) {
  assertCommandInput(input);
  const { actor, action, contactId, appointmentId, idempotencyKey, store, provider } = input;
  if (!store || !provider) throw new TypeError("appointment command dependencies required");
  const now = Number(input.now ?? Date.now());
  const claim = await store.claim({
    actor,
    action,
    contactId,
    appointmentId,
    idempotencyKey,
    requestedStartTime: clean(input.startTime, 100) || null,
  });
  if (claim.state === "completed") return claim.command.result;
  if (claim.state !== "acquired") {
    const error = new Error(claim.state === "conflict" ? "That action key belongs to another request." : "That appointment change is already processing.");
    error.code = claim.state;
    throw error;
  }

  const commandId = claim.command.id;
  try {
    const original = await loadOriginal(provider, contactId, appointmentId);
    if (!original) throw Object.assign(new Error("Appointment not found for this person."), { code: "appointment_not_found" });
    const status = normalizeStatus(original);

    // A provider write can succeed just before the durable completion write
    // fails. Resume from exact provider readback so retries never create or
    // cancel a second appointment.
    if (status === "cancelled" && action === "cancel") {
      const result = {
        status: "completed",
        action,
        actor,
        appointmentId,
        contactId,
        previousStartTime: original.startTime || original.start_time,
        appointmentStatus: "cancelled",
        reminderVerification: "pending_event_evidence",
      };
      await store.complete(commandId, result);
      return result;
    }
    if (status === "cancelled" && action === "reschedule" && claim.command.replacementAppointmentId) {
      const replacement = (await provider.listContactAppointments(contactId))
        .find((appointment) => String(appointment?.id || "") === claim.command.replacementAppointmentId) || null;
      if (!replacement || !MANAGEABLE_STATUSES.has(normalizeStatus(replacement))) {
        throw Object.assign(new Error("The replacement appointment needs manual review."), {
          code: "replacement_unavailable",
          manualReview: true,
        });
      }
      const result = {
        status: "completed",
        action,
        actor,
        appointmentId,
        replacementAppointmentId: String(replacement.id),
        contactId,
        previousStartTime: original.startTime || original.start_time,
        newStartTime: replacement.startTime || replacement.start_time,
        appointmentStatus: normalizeStatus(replacement),
        reminderVerification: "pending_event_evidence",
      };
      await store.complete(commandId, result);
      return result;
    }
    if (!MANAGEABLE_STATUSES.has(status)) {
      throw Object.assign(new Error(`This appointment is already ${status || "not manageable"}.`), { code: "appointment_not_manageable" });
    }
    const startsAt = appointmentStart(original);
    if (!Number.isFinite(startsAt) || startsAt <= now) {
      throw Object.assign(new Error("Only future appointments can be changed here."), { code: "appointment_not_future" });
    }

    if (action === "cancel") {
      await provider.cancelAppointment(original);
      const readback = await loadOriginal(provider, contactId, appointmentId);
      if (!readback || normalizeStatus(readback) !== "cancelled") {
        throw Object.assign(new Error("Cancellation was not confirmed by the calendar."), { code: "cancel_not_confirmed", manualReview: true });
      }
      const result = {
        status: "completed",
        action,
        actor,
        appointmentId,
        contactId,
        previousStartTime: original.startTime || original.start_time,
        appointmentStatus: "cancelled",
        reminderVerification: "pending_event_evidence",
      };
      await store.complete(commandId, result);
      return result;
    }

    const newStartTime = clean(input.startTime, 100);
    const newStartMs = Date.parse(newStartTime);
    const timezone = clean(input.timezone, 100) || WORK_HOURS.timezone;
    const calendarId = clean(original.calendarId || original.calendar_id, 100);
    const dateMatch = /^(\d{4}-\d{2}-\d{2})T/.exec(newStartTime);
    if (!calendarId || !policyForCalendarId(calendarId) || !dateMatch || !Number.isFinite(newStartMs) ||
        newStartMs <= now || newStartMs > now + 33 * DAY_MS) {
      throw Object.assign(new Error("Choose a valid internal time for this appointment."), { code: "invalid_reschedule_time" });
    }
    const schedule = await provider.listSchedule(
      Date.parse(`${dateMatch[1]}T00:00:00-08:00`) - 12 * 60 * 60 * 1000,
      Date.parse(`${dateMatch[1]}T23:59:59-07:00`) + 12 * 60 * 60 * 1000,
    );
    const available = internalAvailability({
      calendarId,
      startDate: dateMatch[1],
      endDate: dateMatch[1],
      events: schedule,
      excludeAppointmentId: appointmentId,
      now,
    });
    if (!available.some((slot) => slot.datetime === newStartTime)) {
      throw Object.assign(new Error("That time is no longer open on Garrett’s schedule."), { code: "slot_unavailable" });
    }

    let replacement = null;
    if (claim.command.replacementAppointmentId) {
      replacement = (await provider.listContactAppointments(contactId))
        .find((appointment) => String(appointment?.id || "") === claim.command.replacementAppointmentId) || null;
      if (!replacement || !MANAGEABLE_STATUSES.has(normalizeStatus(replacement))) {
        throw Object.assign(new Error("The replacement appointment needs manual review."), { code: "replacement_unavailable", manualReview: true });
      }
    } else {
      let checkpointedReplacementId = null;
      try {
        replacement = await provider.createReplacement({
          original,
          startTime: newStartTime,
          timezone,
          onCreated: async (replacementId) => {
            await store.checkpointReplacement(commandId, replacementId);
            checkpointedReplacementId = String(replacementId);
          },
        });
      } catch (createError) {
        const cleanupSucceeded = Number(createError?.cleanupStatus) >= 200 && Number(createError?.cleanupStatus) < 300;
        if (checkpointedReplacementId && cleanupSucceeded) {
          await store.clearReplacement?.(commandId, checkpointedReplacementId);
        } else if ((createError?.phase === "create" && !createError?.appointmentId) ||
                   (createError?.appointmentId && !cleanupSucceeded)) {
          createError.manualReview = true;
          createError.code = createError.code || "replacement_create_unverified";
        }
        throw createError;
      }
    }
    if (!replacement?.id) {
      throw Object.assign(new Error("The calendar did not return a replacement appointment."), { code: "replacement_missing", manualReview: true });
    }

    try {
      await provider.cancelAppointment(original);
    } catch (cancelError) {
      // A transport error is ambiguous: the provider may have accepted the
      // cancellation before the response was lost. Read back before any
      // compensation so Staff can never accidentally cancel both visits.
      const afterFailure = await loadOriginal(provider, contactId, appointmentId);
      if (!afterFailure || normalizeStatus(afterFailure) !== "cancelled") {
        try {
          await provider.cancelAppointment(replacement);
          await store.clearReplacement?.(commandId, String(replacement.id));
        } catch (compensationError) {
          throw Object.assign(new Error("The calendar change needs manual review; both appointments may still be active."), {
            code: "reschedule_compensation_failed",
            manualReview: true,
            cause: compensationError,
          });
        }
        throw Object.assign(new Error("The new appointment was removed and the original appointment stayed unchanged. Try again."), {
          code: "source_cancel_failed",
          cause: cancelError,
        });
      }
    }
    const finalAppointments = await provider.listContactAppointments(contactId);
    const oldReadback = finalAppointments.find((appointment) => String(appointment?.id || "") === appointmentId);
    const newReadback = finalAppointments.find((appointment) => String(appointment?.id || "") === String(replacement.id));
    if (!oldReadback || normalizeStatus(oldReadback) !== "cancelled" || !newReadback || !MANAGEABLE_STATUSES.has(normalizeStatus(newReadback))) {
      throw Object.assign(new Error("The reschedule could not be fully verified."), { code: "reschedule_not_confirmed", manualReview: true });
    }
    const result = {
      status: "completed",
      action,
      actor,
      appointmentId,
      replacementAppointmentId: String(replacement.id),
      contactId,
      previousStartTime: original.startTime || original.start_time,
      newStartTime,
      appointmentStatus: "confirmed",
      reminderVerification: "pending_event_evidence",
    };
    await store.complete(commandId, result);
    return result;
  } catch (error) {
    await store.fail(commandId, error, { manualReview: !!error?.manualReview });
    throw error;
  }
}

/**
 * Staff-owned creation path for a new appointment. The selected service is
 * resolved server-side before this interface is called; callers never supply a
 * provider calendar, title, duration, or status. The same internal availability
 * calculation used by rescheduling is rechecked immediately before creation.
 */
export async function scheduleAppointmentCommand(input) {
  const actor = clean(input?.actor, 40);
  const contactId = clean(input?.contactId, 100);
  const sessionType = clean(input?.sessionType, 64);
  const idempotencyKey = clean(input?.idempotencyKey, 160);
  const startTime = clean(input?.startTime, 100);
  const timezone = clean(input?.timezone, 100) || WORK_HOURS.timezone;
  const booking = input?.booking || null;
  const store = input?.store;
  const provider = input?.provider;
  const now = Number(input?.now ?? Date.now());

  if (!new Set(["Eben", "Garrett"]).has(actor)) throw new TypeError("recognized Staff actor required");
  if (!contactId || !sessionType || !idempotencyKey) throw new TypeError("complete schedule command identity required");
  if (!booking || !policyForCalendarId(booking.calendarId) || !clean(booking.title, 240)) {
    throw new TypeError("server-owned booking definition required");
  }
  if (!store || !provider) throw new TypeError("schedule command dependencies required");

  const claim = await store.claim({ actor, contactId, sessionType, startTime, idempotencyKey, booking });
  if (claim.state === "completed") return claim.operation.result;
  if (claim.state !== "acquired") {
    const error = new Error(claim.state === "conflict" ? "That action key belongs to another request." : "That appointment is already being scheduled.");
    error.code = claim.state;
    throw error;
  }

  try {
    const dateMatch = /^(\d{4}-\d{2}-\d{2})T/.exec(startTime);
    const startsAt = Date.parse(startTime);
    if (!dateMatch || !Number.isFinite(startsAt) || startsAt <= now || startsAt > now + 33 * DAY_MS) {
      throw Object.assign(new Error("Choose a valid internal time for this appointment."), { code: "invalid_schedule_time" });
    }

    if (claim.operation.appointmentId) {
      const existing = (await provider.listContactAppointments(contactId))
        .find((appointment) => String(appointment?.id || "") === String(claim.operation.appointmentId)) || null;
      if (!existing || !MANAGEABLE_STATUSES.has(normalizeStatus(existing))) {
        throw Object.assign(new Error("The created appointment needs manual review."), {
          code: "scheduled_appointment_unavailable",
          manualReview: true,
        });
      }
      const result = {
        status: "completed", action: "schedule", actor, contactId,
        appointmentId: String(existing.id), newStartTime: existing.startTime || existing.start_time,
        appointmentStatus: normalizeStatus(existing), reminderVerification: "pending_event_evidence",
      };
      const canonicalResult = store.canonicalResult?.(result) || result;
      await store.complete(canonicalResult);
      return canonicalResult;
    }

    const schedule = await provider.listSchedule(
      Date.parse(`${dateMatch[1]}T00:00:00-08:00`) - 12 * 60 * 60 * 1000,
      Date.parse(`${dateMatch[1]}T23:59:59-07:00`) + 12 * 60 * 60 * 1000,
    );
    const available = internalAvailability({
      calendarId: booking.calendarId,
      startDate: dateMatch[1],
      endDate: dateMatch[1],
      events: schedule,
      now,
    });
    if (!available.some((slot) => slot.datetime === startTime)) {
      throw Object.assign(new Error("That time is no longer open on Garrett’s schedule."), { code: "slot_unavailable" });
    }

    let created;
    let checkpointedAppointmentId = null;
    try {
      created = await provider.createAppointment({
        contactId,
        booking,
        startTime,
        timezone,
        onCreated: async (appointmentId) => {
          await store.checkpointAppointment(String(appointmentId));
          checkpointedAppointmentId = String(appointmentId);
        },
      });
    } catch (createError) {
      const cleanupSucceeded = Number(createError?.cleanupStatus) >= 200 && Number(createError?.cleanupStatus) < 300;
      if (checkpointedAppointmentId && cleanupSucceeded) {
        await store.clearAppointment?.(checkpointedAppointmentId);
      } else if ((createError?.phase === "create" && !createError?.appointmentId) ||
                 (createError?.appointmentId && !cleanupSucceeded)) {
        createError.manualReview = true;
        createError.code = createError.code || "schedule_create_unverified";
      }
      throw createError;
    }
    if (!created?.id) {
      throw Object.assign(new Error("The calendar did not return the new appointment."), { code: "schedule_missing", manualReview: true });
    }

    const readback = (await provider.listContactAppointments(contactId))
      .find((appointment) => String(appointment?.id || "") === String(created.id)) || null;
    if (!readback || !MANAGEABLE_STATUSES.has(normalizeStatus(readback))) {
      throw Object.assign(new Error("The new appointment was not confirmed by the calendar."), { code: "schedule_not_confirmed", manualReview: true });
    }
    const result = {
      status: "completed", action: "schedule", actor, contactId,
      appointmentId: String(created.id), newStartTime: startTime,
      appointmentStatus: normalizeStatus(readback), reminderVerification: "pending_event_evidence",
    };
    const canonicalResult = store.canonicalResult?.(result) || result;
    await store.complete(canonicalResult);
    return canonicalResult;
  } catch (error) {
    await store.fail(error, { manualReview: !!error?.manualReview });
    throw error;
  }
}
