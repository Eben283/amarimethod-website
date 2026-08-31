import { describe, expect, it } from "vitest";
import { reconcileOwnedAppointmentAuthority } from "./owned-appointment-readiness.js";

const appointment = {
  id: "owned-1",
  contact_id: "contact-1",
  provider_appointment_id: "google-event-1",
  status: "cancelled",
  provider_sync_state: "synced",
};

const schedule = {
  id: "schedule-1", action: "schedule", state: "completed",
  appointment_id: "owned-1", source_appointment_id: null,
  contact_id: "contact-1", provider: "google_calendar",
  provider_record_id: "google-event-1", updated_at: "2026-08-31T17:49:42.101Z",
  result_json: JSON.stringify({
    action: "schedule", contactId: "contact-1", appointmentId: "owned-1",
    providerAppointmentId: "google-event-1", appointmentStatus: "confirmed",
  }),
};

const cancel = {
  id: "cancel-1", action: "cancel", state: "completed",
  appointment_id: "owned-1", source_appointment_id: "owned-1",
  contact_id: "contact-1", provider: "google_calendar",
  provider_record_id: "google-event-1", updated_at: "2026-08-31T17:49:46.616Z",
  result_json: JSON.stringify({
    action: "cancel", contactId: "contact-1", appointmentId: "owned-1",
    providerAppointmentId: "google-event-1", appointmentStatus: "cancelled",
  }),
};

const externalRecord = {
  provider: "google_calendar", object_type: "appointment",
  external_id: "google-event-1", record_type: "appointment", record_id: "owned-1",
};

describe("owned appointment authority readiness", () => {
  it("accepts exact ordered schedule and cancellation proof from the immutable native ledger", () => {
    const result = reconcileOwnedAppointmentAuthority({
      appointments: [appointment],
      commands: [schedule, cancel],
      events: [
        { command_id: "schedule-1", event_type: "completed" },
        { command_id: "cancel-1", event_type: "completed" },
        { command_id: "cancel-1", event_type: "cancelled" },
      ],
      externalRecords: [externalRecord],
    });
    expect(result).toMatchObject({
      state: "ready",
      summary: { appointments: 1, verified: 1, attention: 0, blocking: 0 },
      records: [expect.objectContaining({ state: "verified", completedCommands: 2 })],
      issues: [],
    });
  });

  it("verifies both sides of one reschedule without confusing the replacement provider ID with the source", () => {
    const source = { ...appointment, id: "owned-source", provider_appointment_id: "google-old" };
    const replacement = { ...appointment, id: "owned-replacement", provider_appointment_id: "google-new", status: "confirmed" };
    const reschedule = {
      id: "reschedule-1", action: "reschedule", state: "completed",
      appointment_id: "owned-source", source_appointment_id: "owned-source",
      contact_id: "contact-1", provider: "google_calendar",
      provider_record_id: "google-new", updated_at: "2026-08-31T17:50:00.000Z",
      result_json: JSON.stringify({
        action: "reschedule", contactId: "contact-1", appointmentId: "owned-source",
        replacementAppointmentId: "owned-replacement",
        providerReplacementAppointmentId: "google-new", appointmentStatus: "confirmed",
      }),
    };
    const result = reconcileOwnedAppointmentAuthority({
      appointments: [source, replacement], commands: [reschedule],
      events: [{ command_id: "reschedule-1", event_type: "completed" }],
      externalRecords: [
        { ...externalRecord, external_id: "google-old", record_id: "owned-source" },
        { ...externalRecord, external_id: "google-new", record_id: "owned-replacement" },
      ],
    });
    expect(result).toMatchObject({
      state: "ready",
      summary: { appointments: 2, verified: 2, attention: 0, blocking: 0 },
    });
  });

  it.each([
    ["missing completion event", { events: [{ command_id: "schedule-1", event_type: "completed" }] }, "owned_completion_event_missing"],
    ["missing provider link", { externalRecords: [] }, "owned_provider_link_invalid"],
    ["unfinished provider sync", { appointments: [{ ...appointment, provider_sync_state: "retryable" }] }, "owned_provider_sync_incomplete"],
    ["state mismatch", { appointments: [{ ...appointment, status: "confirmed" }] }, "owned_current_state_mismatch"],
    ["provider mismatch", { externalRecords: [{ ...externalRecord, provider: "ghl" }] }, "owned_provider_identity_mismatch"],
  ])("blocks %s", (_label, override, code) => {
    const result = reconcileOwnedAppointmentAuthority({
      appointments: [appointment],
      commands: [schedule, cancel],
      events: [
        { command_id: "schedule-1", event_type: "completed" },
        { command_id: "cancel-1", event_type: "completed" },
      ],
      externalRecords: [externalRecord],
      ...override,
    });
    expect(result.state).toBe("attention");
    expect(result.issues).toContainEqual(expect.objectContaining({ code, blocking: true }));
  });
});
