import { describe, it, expect } from "vitest";
import {
  APPOINTMENT_EVENT_TYPES,
  classifyAppointmentStatus,
  normalizeAppointmentEvent,
} from "./appointment-event.js";

// The reminder/confirmation engine (twin-migration Unit A) enrolls, reminds, and cancels
// off GHL appointment webhook events. GHL has no such webhook wired today, and its payload
// shape varies by trigger, so this normalizer is deliberately defensive: it maps many raw
// key aliases and status spellings onto ONE typed event. "Get the taxonomy right once."
//
// NOTE: the exact live GHL appointment-webhook JSON is UNVERIFIED (no such webhook exists
// yet — see engine design "Resolve first"). These fixtures cover the shapes GHL is known to
// send for appointment triggers (nested `appointment.*`, flat, and `contact.*`/`calendar.*`).
// Re-confirm against a real capture once the webhook is configured; the alias lists are the
// single place to adjust if the live shape differs.

const NESTED = {
  type: "AppointmentCreate",
  appointment: {
    id: "appt_abc123",
    calendarId: "G7OAnnJuFbMF6nQSlZVQ", // Initial Session In-Person
    contactId: "contact_xyz789",
    startTime: "2026-07-20T15:00:00-07:00",
    appointmentStatus: "confirmed",
  },
  modified_by: "customer",
};

describe("classifyAppointmentStatus", () => {
  it("maps creation-ish statuses to booked", () => {
    for (const s of ["new", "booked", "scheduled", "unconfirmed", "pending"]) {
      expect(classifyAppointmentStatus(s)).toBe(APPOINTMENT_EVENT_TYPES.BOOKED);
    }
  });

  it("maps confirmed to confirmed", () => {
    expect(classifyAppointmentStatus("confirmed")).toBe(APPOINTMENT_EVENT_TYPES.CONFIRMED);
  });

  it("maps showed/attended to showed", () => {
    for (const s of ["showed", "show", "attended"]) {
      expect(classifyAppointmentStatus(s)).toBe(APPOINTMENT_EVENT_TYPES.SHOWED);
    }
  });

  it("maps every no-show spelling to noshow", () => {
    for (const s of ["noshow", "no-show", "no_show", "no show", "missed"]) {
      expect(classifyAppointmentStatus(s)).toBe(APPOINTMENT_EVENT_TYPES.NOSHOW);
    }
  });

  it("maps cancelled/canceled to cancelled", () => {
    for (const s of ["cancelled", "canceled"]) {
      expect(classifyAppointmentStatus(s)).toBe(APPOINTMENT_EVENT_TYPES.CANCELLED);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classifyAppointmentStatus("  Confirmed ")).toBe(APPOINTMENT_EVENT_TYPES.CONFIRMED);
    expect(classifyAppointmentStatus("SHOWED")).toBe(APPOINTMENT_EVENT_TYPES.SHOWED);
  });

  it("returns unknown for unrecognized or empty input", () => {
    for (const s of ["invalid", "", null, undefined, 42, {}]) {
      expect(classifyAppointmentStatus(s)).toBe(APPOINTMENT_EVENT_TYPES.UNKNOWN);
    }
  });
});

describe("normalizeAppointmentEvent", () => {
  it("normalizes a nested appointment.* payload", () => {
    const ev = normalizeAppointmentEvent(NESTED);
    expect(ev).toEqual({
      type: "confirmed",
      recognized: true,
      status: "confirmed",
      calendarId: "G7OAnnJuFbMF6nQSlZVQ",
      contactId: "contact_xyz789",
      appointmentId: "appt_abc123",
      startAt: "2026-07-20T15:00:00-07:00",
      modifiedBy: "customer",
    });
  });

  it("normalizes a flat payload (snake_case + status alias)", () => {
    const ev = normalizeAppointmentEvent({
      appointment_id: "appt_flat",
      calendar_id: "cal_flat",
      contact_id: "contact_flat",
      start_time: "2026-08-01T09:30:00-07:00",
      appointment_status: "cancelled",
      modifiedBy: "user",
    });
    expect(ev.type).toBe("cancelled");
    expect(ev.appointmentId).toBe("appt_flat");
    expect(ev.calendarId).toBe("cal_flat");
    expect(ev.contactId).toBe("contact_flat");
    expect(ev.startAt).toBe("2026-08-01T09:30:00-07:00");
    expect(ev.modifiedBy).toBe("user");
    expect(ev.recognized).toBe(true);
  });

  it("reads calendar.id / contact.id object shapes", () => {
    const ev = normalizeAppointmentEvent({
      id: "appt_obj",
      calendar: { id: "cal_obj" },
      contact: { id: "contact_obj" },
      startTime: "2026-08-02T12:00:00-07:00",
      status: "showed",
    });
    expect(ev.calendarId).toBe("cal_obj");
    expect(ev.contactId).toBe("contact_obj");
    expect(ev.type).toBe("showed");
  });

  it("qualifies a naive Pacific start time with its real offset (reuses normalizeGhlTimestamp)", () => {
    const ev = normalizeAppointmentEvent({
      appointment: { id: "a", calendarId: "c", contactId: "k", startTime: "2026-07-02T15:00:00", appointmentStatus: "new" },
    });
    // naive wall-clock gains the -07:00 summer offset rather than being read as UTC
    expect(ev.startAt).toBe("2026-07-02T15:00:00-07:00");
    expect(ev.type).toBe("booked");
  });

  it("normalizes modifiedBy synonyms and defaults unknown actors to null", () => {
    expect(normalizeAppointmentEvent({ ...NESTED, modified_by: "Contact" }).modifiedBy).toBe("customer");
    expect(normalizeAppointmentEvent({ ...NESTED, modified_by: "staff" }).modifiedBy).toBe("user");
    expect(normalizeAppointmentEvent({ ...NESTED, modified_by: "someone-else" }).modifiedBy).toBe(null);
    const noActor = { ...NESTED };
    delete noActor.modified_by;
    expect(normalizeAppointmentEvent(noActor).modifiedBy).toBe(null);
  });

  it("is not recognized when the status is unmappable", () => {
    const ev = normalizeAppointmentEvent({ appointment: { id: "a", calendarId: "c", contactId: "k", appointmentStatus: "invalid" } });
    expect(ev.type).toBe("unknown");
    expect(ev.recognized).toBe(false);
    expect(ev.appointmentId).toBe("a"); // still extracted for logging
  });

  it("is not recognized when appointmentId is missing (can't act on it)", () => {
    const ev = normalizeAppointmentEvent({ calendarId: "c", contactId: "k", appointmentStatus: "confirmed" });
    expect(ev.type).toBe("confirmed");
    expect(ev.appointmentId).toBe(null);
    expect(ev.recognized).toBe(false);
  });

  it("never throws and returns all-null on garbage input", () => {
    for (const bad of [null, undefined, "", 42, [], "a string"]) {
      const ev = normalizeAppointmentEvent(bad);
      expect(ev.type).toBe("unknown");
      expect(ev.recognized).toBe(false);
      expect(ev.appointmentId).toBe(null);
      expect(ev.startAt).toBe(null);
    }
  });

  it("does not mutate the input payload", () => {
    const input = JSON.parse(JSON.stringify(NESTED));
    const snapshot = JSON.parse(JSON.stringify(NESTED));
    normalizeAppointmentEvent(input);
    expect(input).toEqual(snapshot);
  });
});
