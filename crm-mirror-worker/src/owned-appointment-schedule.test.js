import { describe, expect, it } from "vitest";
import { listOwnedAppointmentSchedule, normalizeOwnedScheduleRange } from "./owned-appointment-schedule.js";

describe("owned appointment schedule", () => {
  it("returns stable owned identity with explicit truth state", async () => {
    const db = {
      prepare: () => ({ bind: (...values) => ({ all: async () => ({ results: [
        {
          id: "appointment-owned", contact_id: "contact-1", display_name: "Partner Person",
          service_id: "partner-initial", service_name: "Partner Initial Session",
          provider_appointment_id: "ghl-1", provider_calendar_id: "calendar-1",
          status: "confirmed", starts_at: "2026-09-01T17:00:00.000Z", ends_at: "2026-09-01T18:00:00.000Z",
          timezone: "America/Los_Angeles", authority: "owned", provider_sync_state: "synced",
          revision: 1, updated_at: "2026-08-28T00:00:00.000Z",
        },
        {
          id: "appointment-mirror", contact_id: "contact-2", display_name: "Legacy Person",
          service_id: "followup-in-person", service_name: "Follow-up Session — In Person",
          provider_appointment_id: "ghl-2", provider_calendar_id: "calendar-2",
          status: "confirmed", starts_at: "2026-09-02T17:00:00.000Z", ends_at: "2026-09-02T17:50:00.000Z",
          timezone: "America/Los_Angeles", authority: "provider_mirror", provider_sync_state: "synced",
          revision: 1, updated_at: "2026-08-28T00:01:00.000Z",
        },
      ], values }) }) }),
    };
    const schedule = await listOwnedAppointmentSchedule(db, {
      startTime: "2026-09-01T00:00:00Z", endTime: "2026-09-03T00:00:00Z",
    });
    expect(schedule.truth).toEqual({ authoritative: 1, propagating: 0, mirrored: 1, degraded: 0 });
    expect(schedule.appointments[0]).toMatchObject({
      id: "appointment-owned", contactId: "contact-1", truthState: "authoritative",
      providerAppointmentId: "ghl-1",
    });
  });

  it("rejects unbounded or invalid ranges", () => {
    expect(() => normalizeOwnedScheduleRange({ startTime: "bad", endTime: "also bad" })).toThrow(/valid appointment range/i);
    expect(() => normalizeOwnedScheduleRange({
      startTime: "2026-08-01T00:00:00Z", endTime: "2026-10-01T00:00:00Z",
    })).toThrow(/45 days/i);
  });
});
