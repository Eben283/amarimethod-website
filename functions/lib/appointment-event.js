// Appointment event normalizer — reminder/confirmation engine (twin-migration Unit A) substrate.
//
// Turns a raw GHL appointment webhook payload into ONE typed, immutable event that the
// reminder engine (enroll/remind/cancel), the nurture engine (entry/exit), and the pipeline
// helper all consume. Pure: no I/O, never throws, never mutates its input.
//
// Why defensive extraction: GHL appointment payloads vary by trigger shape (nested
// `appointment.*`, flat snake_case, `calendar.id`/`contact.id` objects), the same way the
// purchase webhook already handles varying purchase payloads via an alias walker. No GHL
// appointment webhook is configured yet, so the exact live shape is UNVERIFIED — the alias
// lists below are the single place to adjust once a real payload is captured.

import { normalizeGhlTimestamp } from "./datetime.js";

export const APPOINTMENT_EVENT_TYPES = Object.freeze({
  BOOKED: "booked",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  SHOWED: "showed",
  NOSHOW: "noshow",
  UNKNOWN: "unknown",
});

// Raw GHL status spelling -> typed event. Kept exhaustive on the spellings GHL is known to
// use plus common variants; anything unlisted classifies as UNKNOWN (caller ignores it).
const STATUS_TO_TYPE = Object.freeze({
  new: APPOINTMENT_EVENT_TYPES.BOOKED,
  booked: APPOINTMENT_EVENT_TYPES.BOOKED,
  scheduled: APPOINTMENT_EVENT_TYPES.BOOKED,
  unconfirmed: APPOINTMENT_EVENT_TYPES.BOOKED,
  pending: APPOINTMENT_EVENT_TYPES.BOOKED,
  confirmed: APPOINTMENT_EVENT_TYPES.CONFIRMED,
  showed: APPOINTMENT_EVENT_TYPES.SHOWED,
  show: APPOINTMENT_EVENT_TYPES.SHOWED,
  attended: APPOINTMENT_EVENT_TYPES.SHOWED,
  noshow: APPOINTMENT_EVENT_TYPES.NOSHOW,
  "no-show": APPOINTMENT_EVENT_TYPES.NOSHOW,
  no_show: APPOINTMENT_EVENT_TYPES.NOSHOW,
  "no show": APPOINTMENT_EVENT_TYPES.NOSHOW,
  missed: APPOINTMENT_EVENT_TYPES.NOSHOW,
  cancelled: APPOINTMENT_EVENT_TYPES.CANCELLED,
  canceled: APPOINTMENT_EVENT_TYPES.CANCELLED,
});

const APPOINTMENT_ID_KEYS = ["appointment.id", "appointmentId", "appointment_id", "appointment.appointmentId", "id"];
const CALENDAR_ID_KEYS = ["appointment.calendarId", "calendarId", "calendar_id", "appointment.calendar_id", "calendar.id"];
const CONTACT_ID_KEYS = ["appointment.contactId", "contactId", "contact_id", "appointment.contact_id", "contact.id"];
const START_AT_KEYS = ["appointment.startTime", "startTime", "start_time", "appointment.start_time", "appointment.startAt", "startAt"];
const STATUS_KEYS = ["appointment.appointmentStatus", "appointmentStatus", "appointment_status", "appointment.status", "status"];
const MODIFIED_BY_KEYS = ["modified_by", "modifiedBy", "appointment.modifiedBy", "appointment.modified_by", "appointment.source", "source"];
// This is GHL's trigger-level “Event Type” (for example, Normal), not the
// appointment status above. Keep the two concepts separate: a normal
// appointment can be confirmed, cancelled, or no-showed.
const APPOINTMENT_EVENT_KIND_KEYS = [
  "appointment.eventType", "appointment.event_type", "eventType", "event_type",
  "appointment.appointmentType", "appointment.appointment_type", "appointment.type",
];

// Dotted-path alias walker. Same semantics as ghl-purchase-webhook.js's extractField:
// first alias yielding a non-empty scalar wins; returns a trimmed string or null.
function pick(body, keys) {
  if (body == null || typeof body !== "object") return null;
  for (const key of keys) {
    let val = body;
    for (const part of key.split(".")) {
      if (val == null || typeof val !== "object") {
        val = undefined;
        break;
      }
      val = val[part];
    }
    if (val != null && val !== "" && typeof val !== "object") {
      const s = String(val).trim();
      if (s !== "") return s;
    }
  }
  return null;
}

/**
 * Map a raw GHL appointment status string to a typed event type.
 * @param {unknown} rawStatus
 * @returns {string} one of APPOINTMENT_EVENT_TYPES
 */
export function classifyAppointmentStatus(rawStatus) {
  if (typeof rawStatus !== "string") return APPOINTMENT_EVENT_TYPES.UNKNOWN;
  const key = rawStatus.trim().toLowerCase();
  return STATUS_TO_TYPE[key] || APPOINTMENT_EVENT_TYPES.UNKNOWN;
}

// GHL sends the actor that changed the appointment; the twin trigger filters key on
// user (internal/staff) vs customer (the contact self-serving). Normalize the common
// spellings; anything else is null (caller treats null as "either").
function normalizeModifiedBy(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (["user", "staff", "internal", "assigned_user", "assigneduser"].includes(v)) return "user";
  if (["customer", "contact", "client"].includes(v)) return "customer";
  return null;
}

function normalizeAppointmentEventKind(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return value || null;
}

/**
 * Normalize a raw GHL appointment webhook payload into a typed, immutable event.
 * Never throws; unrecognized or malformed input yields a safe all-null event with
 * type "unknown" and recognized=false.
 *
 * @param {unknown} payload
 * @returns {{
 *   type: string, recognized: boolean, status: string|null,
 *   calendarId: string|null, contactId: string|null, appointmentId: string|null,
 *   startAt: string|null, modifiedBy: ("user"|"customer"|null),
 *   appointmentEventType: string|null
 * }}
 */
export function normalizeAppointmentEvent(payload) {
  const rawStatus = pick(payload, STATUS_KEYS);
  const type = classifyAppointmentStatus(rawStatus);
  const appointmentId = pick(payload, APPOINTMENT_ID_KEYS);
  const rawStart = pick(payload, START_AT_KEYS);

  return {
    type,
    // Actionable only when we both understand the status AND can key on an appointment.
    recognized: type !== APPOINTMENT_EVENT_TYPES.UNKNOWN && appointmentId != null,
    status: rawStatus ? rawStatus.toLowerCase() : null,
    calendarId: pick(payload, CALENDAR_ID_KEYS),
    contactId: pick(payload, CONTACT_ID_KEYS),
    appointmentId,
    startAt: rawStart != null ? normalizeGhlTimestamp(rawStart) : null,
    modifiedBy: normalizeModifiedBy(pick(payload, MODIFIED_BY_KEYS)),
    appointmentEventType: normalizeAppointmentEventKind(pick(payload, APPOINTMENT_EVENT_KIND_KEYS)),
  };
}
