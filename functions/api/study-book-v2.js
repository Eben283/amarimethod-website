// Public single-entry Amari study booking endpoint. The customer stays on
// amarimethod.com; GHL remains the contact/calendar provider behind it.
import { applyTagDelta, ghlFetch } from "../lib/ghl.js";
import { STUDY_CALENDAR_ID } from "../lib/studies.js";
import { appointmentEndTime, parsePacificWallClock } from "../lib/datetime.js";
import {
  assertSlotRespectsAppBuffer,
  fetchAppBufferEvents,
  filterSlotsByAppBuffer,
} from "../lib/app-owned-buffer.js";
import {
  AppointmentHandoffError,
  createConfirmedAppointment,
} from "../lib/ghl-appointment-handoff.js";
import {
  checkpointBookingAppointment,
  checkpointBookingCreateAttempt,
  claimBookingOperation,
  clearBookingAppointmentCheckpoint,
  completeBookingOperation,
  failBookingOperation,
} from "../lib/booking-operations.js";
import { emitPathHop } from "../lib/ops-path-emit.js";
import { ensureStudyBookingConfirmedMarker } from "../lib/study-enrollment-marker.js";
import {
  StudyBookingRuntimeError,
  resolveStudyBookingRuntime,
  studyBookingCorsOrigin,
} from "../lib/study-booking-runtime.js";
import {
  STUDY_NAME_FIELD_ID,
  getLiveStudyBooking,
  studyEnrollmentTags,
  studyOperationKind,
  validateStudyBooking,
} from "../lib/study-booking.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const APPOINTMENT_ENDPOINT = GHL_API_BASE + "/calendars/events/appointments";

class RetryableFlowError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "RetryableFlowError";
    this.status = status;
  }
}

class ManualReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManualReviewError";
  }
}

function headers(context) {
  return {
    "Access-Control-Allow-Origin": studyBookingCorsOrigin(context.request, context.env),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function json(data, status, context) {
  return new Response(JSON.stringify(data), { status, headers: headers(context) });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T12:00:00Z"));
}

function flattenSlots(data) {
  const slots = [];
  for (const date of Object.keys(data || {}).sort()) {
    const values = Array.isArray(data[date]?.slots) ? data[date].slots : [];
    for (const datetime of values.slice().sort()) {
      const parts = (String(datetime).split("T")[1] || "").split(":");
      const hour = Number.parseInt(parts[0], 10);
      const minute = Number.parseInt(parts[1], 10);
      if (Number.isInteger(hour) && Number.isInteger(minute)) {
        slots.push({ date, hour, minute, datetime });
      }
    }
  }
  return slots;
}

async function slots(context, startDate, endDate, timezone) {
  const start = Date.parse(startDate + "T00:00:00Z");
  const end = Date.parse(endDate + "T23:59:59Z") + 12 * 60 * 60 * 1000;
  const url = GHL_API_BASE + "/calendars/" + STUDY_CALENDAR_ID +
    "/free-slots?startDate=" + start + "&endDate=" + end +
    "&timezone=" + encodeURIComponent(timezone);
  const response = await ghlFetch(context, url);
  if (!response.ok) throw new Error("Could not load available times.");
  const rawSlots = flattenSlots(await response.json());
  const events = await fetchAppBufferEvents(context, start, end);
  return filterSlotsByAppBuffer(rawSlots, STUDY_CALENDAR_ID, events);
}

async function rateLimit(kv, key) {
  if (!kv) return false;
  const current = Number(await kv.get(key)) || 0;
  if (current >= 12) return true;
  await kv.put(key, String(current + 1), { expirationTtl: 3600 });
  return false;
}

function contactIdFrom(data) {
  return data?.contact?.id ||
    data?.contactId ||
    (Array.isArray(data?.contacts) ? data.contacts[0]?.id : null) ||
    data?.id ||
    null;
}

// Read-only contact resolution lets a retry claim its durable operation before
// a buffer check sees the already-created appointment. POST /contacts/search is
// a search operation, not a provider mutation.
export async function findExistingContactId(context, email) {
  try {
    const duplicate = await ghlFetch(
      context,
      GHL_API_BASE + "/contacts/search/duplicate?locationId=" +
        GHL_LOCATION_ID + "&email=" + encodeURIComponent(email),
    );
    if (duplicate.ok) {
      const id = contactIdFrom(await duplicate.json());
      if (id) return id;
    }
  } catch (error) {
    console.warn("[study-book] duplicate contact lookup failed:", error.message);
  }

  const search = await ghlFetch(context, GHL_API_BASE + "/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      locationId: GHL_LOCATION_ID,
      pageLimit: 1,
      filters: [{ field: "email", operator: "eq", value: email }],
    }),
  });
  if (!search.ok) {
    throw new RetryableFlowError("We could not verify your study record. Please try again.", 500);
  }
  return contactIdFrom(await search.json());
}

// This is the only pre-appointment contact mutation. Study Name is written with
// identity/source so the later confirmed-status transition can never render a
// contextless template. Trigger tags are deliberately absent.
export async function saveStudyIdentity(context, contactId, data) {
  const payload = {
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone,
    email: data.email,
    source: data.config.source,
    customFields: [{ id: STUDY_NAME_FIELD_ID, fieldValue: data.config.studyName }],
  };

  const response = contactId
    ? await ghlFetch(context, GHL_API_BASE + "/contacts/" + encodeURIComponent(contactId), {
        method: "PUT",
        body: JSON.stringify(payload),
      })
    : await ghlFetch(context, GHL_API_BASE + "/contacts/upsert", {
        method: "POST",
        body: JSON.stringify({ ...payload, locationId: GHL_LOCATION_ID }),
      });

  if (!response.ok) {
    throw new RetryableFlowError("We could not save your study details. Please try again.");
  }
  if (contactId) return contactId;
  const createdId = contactIdFrom(await response.json());
  if (!createdId) throw new RetryableFlowError("We could not verify your study record. Please try again.");
  return createdId;
}

function operationInput(contactId, data) {
  return {
    opKey: "study-book:" + data.idempotencyKey,
    kind: studyOperationKind(data.config, data.bodyPart, data.publishOptIn),
    contactId,
    calendarId: STUDY_CALENDAR_ID,
    startTime: data.startTime,
  };
}

function appointmentStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanupWasAccepted(status) {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

async function readContactAppointments(context, contactId) {
  const response = await ghlFetch(
    context,
    GHL_API_BASE + "/contacts/" + encodeURIComponent(contactId) + "/appointments",
  );
  if (!response.ok) {
    throw new RetryableFlowError("We could not verify the calendar before booking. Please try again.", 500);
  }
  const body = await response.json();
  return body.events || body.appointments || [];
}

function isExactStudyAppointment(item, data) {
  if (item.calendarId !== STUDY_CALENDAR_ID) return false;
  const status = appointmentStatus(item.appointmentStatus);
  if (status === "cancelled" || status === "canceled" || status === "noshow") return false;
  const observedStart = parsePacificWallClock(item.startTime || "");
  const expectedStart = parsePacificWallClock(data.startTime);
  return Number.isFinite(observedStart) &&
    Number.isFinite(expectedStart) &&
    Math.abs(observedStart - expectedStart) <= 60_000;
}

function hasMatchingCreateAttempt(operation) {
  const marker = operation?.result?.createAttempt;
  return Boolean(marker) &&
    marker.kind === operation.kind &&
    marker.contactId === operation.contactId &&
    marker.calendarId === operation.calendarId &&
    marker.startTime === operation.startTime;
}

// Reconcile before every create. Adoption is allowed only when this exact
// operation durably recorded a create attempt before the provider POST. An
// unexplained matching appointment under a fresh key is not safe provenance.
async function adoptExactAppointment(context, db, operation, data) {
  const matches = (await readContactAppointments(context, operation.contactId))
    .filter((item) => isExactStudyAppointment(item, data));
  if (matches.length > 1) {
    throw new ManualReviewError("More than one active appointment exists for this study time.");
  }
  if (matches.length === 0) return operation;
  if (!matches[0].id || !hasMatchingCreateAttempt(operation)) {
    throw new ManualReviewError("An existing appointment has no matching booking-operation provenance.");
  }
  await checkpointBookingAppointment(db, operation.opKey, matches[0].id);
  return { ...operation, appointmentId: matches[0].id };
}

async function verifyCancelledAppointment(context, contactId, appointmentId) {
  try {
    const appointments = await readContactAppointments(context, contactId);
    const appointment = appointments.find((item) => item.id === appointmentId);
    const status = appointmentStatus(appointment?.appointmentStatus);
    return status === "cancelled" || status === "canceled";
  } catch (error) {
    console.warn("[study-book] cancellation readback failed:", error.message);
    return false;
  }
}

async function preserveUncertainCheckpoint(db, operation, appointmentId) {
  try {
    await checkpointBookingAppointment(db, operation.opKey, appointmentId);
  } catch (error) {
    console.error(
      "[study-book] could not preserve uncertain appointment " + appointmentId + ":",
      error.message,
    );
  }
}

async function checkpointedAppointment(context, db, operation, data, progress) {
  const response = await ghlFetch(
    context,
    GHL_API_BASE + "/contacts/" + encodeURIComponent(operation.contactId) + "/appointments",
  );
  if (!response.ok) {
    throw new ManualReviewError("The reserved appointment could not be reconciled.");
  }

  const body = await response.json();
  const appointments = body.events || body.appointments || [];
  const appointment = appointments.find((item) => item.id === operation.appointmentId);
  if (!appointment) {
    throw new ManualReviewError("The reserved appointment is not visible in the provider readback.");
  }
  if (appointment.calendarId !== STUDY_CALENDAR_ID) {
    throw new ManualReviewError("The reserved appointment calendar could not be verified.");
  }

  const observedStart = parsePacificWallClock(appointment.startTime || "");
  const expectedStart = parsePacificWallClock(data.startTime);
  if (!Number.isFinite(observedStart) || !Number.isFinite(expectedStart) ||
      Math.abs(observedStart - expectedStart) > 60_000) {
    throw new ManualReviewError("The reserved appointment time could not be verified.");
  }

  const status = appointmentStatus(appointment.appointmentStatus);
  if (status === "cancelled" || status === "canceled" || status === "noshow") {
    await clearBookingAppointmentCheckpoint(db, operation.opKey, operation.appointmentId);
    progress.appointmentId = null;
    progress.appointmentConfirmed = false;
    progress.createAttemptRecorded = false;
    throw new RetryableFlowError("The earlier reservation was cancelled. Please submit again.");
  }
  if (status !== "new" && status !== "confirmed") {
    throw new ManualReviewError("The reserved appointment has an unexpected status.");
  }

  // Record provider truth before the reassertion call so a later failure still
  // reports the known reservation phase and never invites a second booking.
  progress.appointmentId = operation.appointmentId;
  progress.appointmentConfirmed = status === "confirmed";

  // A retry must reassert source + Study Name before any tag mutation. For a
  // new appointment this also precedes the status transition.
  await saveStudyIdentity(context, operation.contactId, data);

  if (status === "confirmed") {
    return { id: operation.appointmentId, confirmed: true };
  }

  const confirm = await ghlFetch(
    context,
    APPOINTMENT_ENDPOINT + "/" + encodeURIComponent(operation.appointmentId),
    { method: "PUT", body: JSON.stringify({ appointmentStatus: "confirmed" }) },
  );
  if (!confirm.ok) {
    const detail = await confirm.text().catch(() => "response body unavailable");
    let cleanupStatus = null;
    try {
      const cleanup = await ghlFetch(
        context,
        APPOINTMENT_ENDPOINT + "/" + encodeURIComponent(operation.appointmentId),
        { method: "PUT", body: JSON.stringify({ appointmentStatus: "cancelled" }) },
      );
      cleanupStatus = cleanup.status;
    } catch {
      cleanupStatus = 0;
    }
    throw new AppointmentHandoffError(
      "confirm",
      confirm.status,
      detail,
      operation.appointmentId,
      cleanupStatus,
    );
  }
  progress.appointmentConfirmed = true;
  return { id: operation.appointmentId, confirmed: true };
}

function deferEvidence(context, evidenceEnv, payload) {
  const promise = emitPathHop(evidenceEnv, payload);
  if (typeof context.waitUntil === "function") context.waitUntil(promise);
}

async function markOperationFailure(db, opKey, error, manualReview) {
  try {
    await failBookingOperation(db, opKey, error?.message || error, { manualReview });
  } catch (stateError) {
    console.error("[study-book] operation failure state:", stateError.message);
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: headers(context),
  });
}

export async function onRequestGet(context) {
  let runtime;
  try {
    runtime = resolveStudyBookingRuntime(context);
  } catch (error) {
    if (error instanceof StudyBookingRuntimeError) {
      return json({ error: error.message }, error.status, context);
    }
    throw error;
  }
  const url = new URL(context.request.url);
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const timezone = url.searchParams.get("timezone") || "America/Los_Angeles";
  const studySlug = url.searchParams.get("study") || "";

  if (studySlug && !getLiveStudyBooking(studySlug)) {
    return json({ error: "Choose one of the five current studies." }, 400, context);
  }
  if (!validDate(startDate) || !validDate(endDate) ||
      Date.parse(endDate + "T00:00:00Z") < Date.parse(startDate + "T00:00:00Z")) {
    return json({ error: "Choose a valid calendar month." }, 400, context);
  }
  try {
    return json({ slots: await slots(runtime.providerContext, startDate, endDate, timezone) }, 200, context);
  } catch (error) {
    console.error("[study-book] slots:", error.message);
    return json({ error: "Could not load available times. Please try again." }, 422, context);
  }
}

export async function onRequestPost(context) {
  let runtime;
  try {
    runtime = resolveStudyBookingRuntime(context, { mutation: true });
  } catch (error) {
    if (error instanceof StudyBookingRuntimeError) {
      return json({ error: error.message }, error.status, context);
    }
    throw error;
  }
  let raw;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "Invalid booking request." }, 400, context);
  }

  const validated = validateStudyBooking(raw);
  if (validated.error) return json({ error: validated.error }, 400, context);
  const data = validated.data;

  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  if (await rateLimit(runtime.rateLimitKv, "study-book:" + ip)) {
    return json({ error: "Please wait a moment and try again." }, 429, context);
  }

  const db = runtime.db;
  let contactId = null;
  let operation = null;
  let operationClaimed = false;
  const progress = {
    appointmentId: null,
    appointmentConfirmed: false,
    markerVerified: false,
    createAttemptRecorded: false,
  };

  try {
    const existingContactId = await findExistingContactId(runtime.providerContext, data.email);
    if (runtime.mode === "preview" && existingContactId !== runtime.fixtureContactId) {
      return json({
        error: "This preview is limited to the approved proof contact.",
      }, 403, context);
    }

    // Existing contacts can claim first, using the provider ID resolved by a
    // read-only lookup. That is what lets a confirmed/tag-pending retry bypass
    // the now-occupied slot without ever creating a duplicate.
    if (existingContactId) {
      contactId = existingContactId;
      const claim = await claimBookingOperation(db, operationInput(contactId, data));
      if (claim.state === "completed") {
        return json({ ...claim.operation.result, alreadyProcessed: true }, 200, context);
      }
      if (claim.state === "in_progress") {
        return json({
          error: "This booking is still being finished. Wait a moment, then submit again.",
          retrySameKey: true,
          doNotRebook: true,
          reservationPending: true,
        }, 409, context);
      }
      if (claim.state === "manual_review" || claim.state === "conflict") {
        return json({
          error: "This booking needs staff review. Do not book another time; email eben@amarimethod.com.",
          manualReview: true,
          doNotRebook: true,
        }, 409, context);
      }
      operation = claim.operation;
      operationClaimed = true;
    } else {
      // No provider contact exists, so the slot/buffer readback precedes the
      // first GHL mutation. A rejected slot cannot create or tag a contact.
      await assertSlotRespectsAppBuffer(runtime.providerContext, data.startTime, STUDY_CALENDAR_ID);
      contactId = await saveStudyIdentity(runtime.providerContext, null, data);
      const claim = await claimBookingOperation(db, operationInput(contactId, data));
      if (claim.state !== "acquired") {
        if (claim.state === "completed") {
          return json({ ...claim.operation.result, alreadyProcessed: true }, 200, context);
        }
        return json({
          error: "This booking key is already in use. Submit the same booking again or refresh after choosing a different time.",
          retrySameKey: claim.state === "in_progress",
          doNotRebook: claim.state === "in_progress",
          reservationPending: claim.state === "in_progress",
          manualReview: claim.state === "manual_review" || claim.state === "conflict",
        }, 409, context);
      }
      operation = claim.operation;
      operationClaimed = true;
    }

    progress.createAttemptRecorded = hasMatchingCreateAttempt(operation);

    // Before any create, reconcile an exact active provider appointment. Only
    // this same operation's durable pre-create marker authorizes adoption.
    operation = operation.appointmentId
      ? operation
      : await adoptExactAppointment(runtime.providerContext, db, operation, data);

    if (operation.appointmentId) {
      progress.appointmentId = operation.appointmentId;
      await checkpointedAppointment(runtime.providerContext, db, operation, data, progress);
    } else {
      // Existing contacts reach their buffer gate here, before their first
      // identity/Study Name mutation for a genuinely new appointment.
      if (existingContactId) {
        await assertSlotRespectsAppBuffer(runtime.providerContext, data.startTime, STUDY_CALENDAR_ID);
        await saveStudyIdentity(runtime.providerContext, contactId, data);
      }

      const createMarker = await checkpointBookingCreateAttempt(db, operation.opKey, operation);
      progress.createAttemptRecorded = true;
      operation = {
        ...operation,
        result: { ...(operation.result || {}), createAttempt: createMarker.createAttempt },
      };

      const created = await createConfirmedAppointment({
        endpoint: APPOINTMENT_ENDPOINT,
        request: (url, options) => ghlFetch(runtime.providerContext, url, options),
        payload: {
          calendarId: STUDY_CALENDAR_ID,
          locationId: GHL_LOCATION_ID,
          contactId,
          startTime: data.startTime,
          endTime: appointmentEndTime(data.startTime, 15),
          selectedTimezone: data.timezone,
          title: "Amari Study 15-Minute Session",
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
        },
        onCreated: async (id) => {
          progress.appointmentId = id;
          await checkpointBookingAppointment(db, operation.opKey, id);
        },
      });
      progress.appointmentId = created.id || created.appointment?.id || null;
      if (!progress.appointmentId) {
        throw new RetryableFlowError("The appointment confirmation was incomplete.");
      }
      progress.appointmentConfirmed = true;
    }

    // The persistent control marker is the post-confirm coexistence boundary.
    // It must be visible in provider readback before any participant trigger tag.
    await ensureStudyBookingConfirmedMarker(runtime.providerContext, contactId);
    progress.markerVerified = true;

    // Participant/side/publish tags are the trigger boundary. They are applied
    // only after the appointment and marker are confirmed and only through additive deltas.
    await applyTagDelta(runtime.providerContext, contactId, {
      add: studyEnrollmentTags(data.config, data.bodyPart, data.publishOptIn),
    });

    const result = {
      success: true,
      study: { slug: data.config.slug, name: data.config.studyName },
      appointment: { id: progress.appointmentId, startTime: data.startTime },
    };
    await completeBookingOperation(db, operation.opKey, result);
    operationClaimed = false;

    deferEvidence(context, runtime.evidenceEnv, {
      pathId: "study_native_book",
      hopId: "confirmed_and_enrolled",
      outcome: "ok",
      summary: data.config.studyName + " appointment confirmed, marker verified, and participant tags applied",
      source: "study-book",
      contactId,
      personLabel: data.name,
      correlationId: operation.opKey,
      trigger: { type: "study.booking", id: data.config.slug },
    });
    return json(result, 200, context);
  } catch (error) {
    console.error("[study-book] booking:", error.message);

    if (error instanceof AppointmentHandoffError && error.appointmentId) {
      progress.appointmentId = error.appointmentId;
      const cancellationVerified = cleanupWasAccepted(error.cleanupStatus) &&
        await verifyCancelledAppointment(runtime.providerContext, contactId, progress.appointmentId);
      if (cancellationVerified) {
        try {
          await clearBookingAppointmentCheckpoint(db, operation.opKey, progress.appointmentId);
        } catch (clearError) {
          console.warn("[study-book] verified-cancel checkpoint clear:", clearError.message);
        }
        if (operationClaimed) {
          const verifiedError = new Error(
            error.message + " [appointmentId=" + progress.appointmentId + "; cancellation verified]",
          );
          await markOperationFailure(db, operation.opKey, verifiedError, false);
        }
        return json({
          error: "That appointment was not confirmed. Submit the same booking again or choose another available time.",
          retryable: true,
        }, 422, context);
      }

      if (operationClaimed) {
        await preserveUncertainCheckpoint(db, operation, progress.appointmentId);
        const uncertainError = new Error(
          error.message + " [appointmentId=" + progress.appointmentId + "; cancellation unverified]",
        );
        await markOperationFailure(db, operation.opKey, uncertainError, true);
      }
      return json({
        error: "We could not verify whether the reservation was cancelled. Do not book another time; email eben@amarimethod.com.",
        manualReview: true,
        doNotRebook: true,
        appointmentUncertain: true,
      }, 409, context);
    }

    if (error instanceof ManualReviewError) {
      if (operationClaimed) await markOperationFailure(db, operation.opKey, error, true);
      return json({
        error: "Your reservation needs staff review. Do not book another time; email eben@amarimethod.com.",
        manualReview: true,
        doNotRebook: true,
      }, 409, context);
    }

    if (operationClaimed) {
      await markOperationFailure(db, operation.opKey, error, false);
    }

    const sameKeyOnly = progress.appointmentConfirmed ||
      Boolean(progress.appointmentId) ||
      progress.createAttemptRecorded;
    deferEvidence(context, runtime.evidenceEnv, {
      pathId: "study_native_book",
      hopId: progress.appointmentConfirmed
        ? progress.markerVerified ? "apply_participant_tags" : "verify_booking_marker"
        : sameKeyOnly ? "reconcile_appointment" : "create_appointment",
      outcome: "fail",
      summary: progress.appointmentConfirmed
        ? progress.markerVerified
          ? "Study appointment reserved but participant tags are pending"
          : "Study appointment reserved but the enrollment marker is not verified"
        : sameKeyOnly
          ? "Study booking requires same-key appointment reconciliation"
          : "Study booking did not reach a provider create attempt",
      source: "study-book",
      contactId,
      personLabel: data.name,
      correlationId: operation?.opKey || "study-book:" + data.idempotencyKey,
      reasonCode: progress.appointmentConfirmed
        ? "enrollment_pending"
        : sameKeyOnly ? "appointment_reconciliation_pending" : "booking_failed",
    });

    if (progress.appointmentConfirmed) {
      return json({
        error: "Your time is reserved, but we could not finish the study enrollment. Submit again to finish; this will not create another appointment.",
        booked: true,
        retrySameKey: true,
        doNotRebook: true,
        reservationPending: true,
        appointment: { id: progress.appointmentId, startTime: data.startTime },
      }, 422, context);
    }

    if (sameKeyOnly) {
      return json({
        error: progress.appointmentId
          ? "A reservation exists but is not fully reconciled. Submit the same booking again; do not choose another time."
          : "The calendar request may have been accepted. Submit the same booking again; do not choose another time.",
        retrySameKey: true,
        doNotRebook: true,
        appointmentUncertain: true,
        reservationPending: true,
        appointment: { id: progress.appointmentId, startTime: data.startTime },
      }, 422, context);
    }

    return json({
      error: error instanceof RetryableFlowError
        ? error.message
        : "We could not save that booking. Please try again.",
      retryable: true,
    }, error instanceof RetryableFlowError ? error.status : 422, context);
  }
}
