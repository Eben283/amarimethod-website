import { describe, expect, it } from "vitest";
import { appointmentProjectionReadiness, recordAppointmentObservation } from "./appointment-projection-store.js";

const appointment = {
  externalId: "appointment-1",
  contactExternalId: "contact-1",
  calendarId: "calendar-1",
  providerStatusRaw: "confirmed",
  status: "confirmed",
  startsAt: "2026-08-10T17:00:00.000Z",
  endsAt: "2026-08-10T17:50:00.000Z",
  timezone: "America/Los_Angeles",
};

describe("appointment projection store", () => {
  it("appends exact webhook evidence once and classifies later schedule movement", async () => {
    const writes = [];
    let prior = null;
    const db = {
      prepare: (sql) => ({
        bind: (...values) => ({
          first: async () => {
            if (sql.includes("provider_event_id = ?") && sql.includes("evidence_hash = ?")) return null;
            if (sql.includes("provider_appointment_id = ?") && sql.includes("ORDER BY")) return prior;
            return null;
          },
          run: async () => {
            writes.push({ sql, values });
            if (sql.includes("INSERT INTO appointment_projection_events")) {
              prior = {
                id: values[0], provider: values[1], source_kind: values[2], provider_event_id: values[3],
                provider_event_type: values[4], provider_appointment_id: values[5], provider_contact_id: values[6],
                provider_calendar_id: values[7], provider_status_raw: values[8], normalized_status: values[9],
                starts_at: values[10], ends_at: values[11], timezone: values[12], transition_type: values[13],
                provider_occurred_at: values[14], observed_at: values[15], evidence_hash: values[16],
              };
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    };

    await expect(recordAppointmentObservation(db, appointment, {
      sourceKind: "webhook",
      providerEventId: "webhook-1",
      providerEventType: "AppointmentCreate",
      providerOccurredAt: "2026-08-08T16:59:59.000Z",
      evidenceHash: "raw-body-sha256",
    }, "2026-08-08T17:00:00.000Z")).resolves.toMatchObject({ duplicate: false, transition: "create" });

    await expect(recordAppointmentObservation(db, {
      ...appointment,
      startsAt: "2026-08-10T18:00:00.000Z",
      endsAt: "2026-08-10T18:50:00.000Z",
    }, {
      sourceKind: "webhook",
      providerEventId: "webhook-2",
      providerEventType: "AppointmentUpdate",
      evidenceHash: "raw-body-sha256-2",
    }, "2026-08-08T17:05:00.000Z")).resolves.toMatchObject({ duplicate: false, transition: "reschedule" });

    expect(writes).toHaveLength(2);
    expect(writes[0].values).toEqual(expect.arrayContaining([
      "webhook-1", "appointment-1", "contact-1", "calendar-1", "raw-body-sha256", "create",
    ]));
  });

  it("returns unavailable readiness instead of throwing when shadow storage is not migrated", async () => {
    const db = { prepare: () => { throw new Error("no such table: appointment_projection_events"); } };
    await expect(appointmentProjectionReadiness(db, "2026-08-08T17:00:00.000Z")).resolves.toMatchObject({
      configured: false,
      shadowOnly: true,
      state: "unavailable",
      liveScheduleFallback: true,
      bufferPolicy: { state: "confirmed", runtimeAppOwnedMinutes: 20, historicalDocumentedMinutes: 10 },
    });
  });

  it("reconciles append-only rows against the current mirror and reports bounded coverage", async () => {
    const event = {
      id: "event-1", provider: "ghl", source_kind: "snapshot", provider_event_id: "snapshot-1",
      provider_event_type: "sync_initial", provider_appointment_id: "appointment-1", provider_contact_id: "contact-1",
      provider_calendar_id: "calendar-1", provider_status_raw: "confirmed", normalized_status: "confirmed",
      starts_at: appointment.startsAt, ends_at: appointment.endsAt, timezone: appointment.timezone,
      transition_type: "create", provider_occurred_at: null, observed_at: "2026-08-08T17:00:00.000Z", evidence_hash: "hash-1",
    };
    const db = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => ({ count: sql.includes("appointment_projection_events") ? 1 : 1 }),
          all: async () => ({ results: sql.includes("appointment_projection_events") ? [event] : [{
            provider_appointment_id: "appointment-1", provider_calendar_id: "calendar-1", provider_status_raw: "confirmed",
            status: "confirmed", starts_at: appointment.startsAt, ends_at: appointment.endsAt, timezone: appointment.timezone,
          }] }),
        }),
      }),
    };

    await expect(appointmentProjectionReadiness(db, "2026-08-08T17:05:00.000Z")).resolves.toMatchObject({
      configured: true,
      shadowOnly: true,
      state: "baseline_ready",
      liveScheduleFallback: true,
      coverage: { observationsRead: 1, totalObservations: 1, truncated: false },
      reconciliation: { summary: {
        appointments: 1, observations: 1, conflicts: 0, totalIssues: 1,
        historyGaps: 1, blockingHistoryGaps: 0, historicalBaselines: 1,
      } },
      bufferPolicy: { state: "confirmed" },
    });
  });

  it("keeps an unobserved current appointment blocking while separating accepted baselines", async () => {
    const event = {
      id: "event-1", provider: "ghl", source_kind: "snapshot", provider_event_id: "snapshot-1",
      provider_event_type: "sync_initial", provider_appointment_id: "appointment-1", provider_contact_id: "contact-1",
      provider_calendar_id: "calendar-1", provider_status_raw: "confirmed", normalized_status: "confirmed",
      starts_at: appointment.startsAt, ends_at: appointment.endsAt, timezone: appointment.timezone,
      transition_type: "create", provider_occurred_at: null, observed_at: "2026-08-08T17:00:00.000Z", evidence_hash: "hash-1",
    };
    const db = {
      prepare: (sql) => ({ bind: () => ({
        first: async () => ({ count: 1 }),
        all: async () => ({ results: sql.includes("appointment_projection_events") ? [event] : [
          { provider_appointment_id: "appointment-1", provider_calendar_id: "calendar-1", provider_status_raw: "confirmed", status: "confirmed", starts_at: appointment.startsAt, ends_at: appointment.endsAt, timezone: appointment.timezone },
          { provider_appointment_id: "appointment-2", provider_calendar_id: "calendar-1", provider_status_raw: "confirmed", status: "confirmed", starts_at: appointment.startsAt, ends_at: appointment.endsAt, timezone: appointment.timezone },
        ] }),
      }) }),
    };

    await expect(appointmentProjectionReadiness(db, "2026-08-08T17:05:00.000Z")).resolves.toMatchObject({
      state: "attention",
      reconciliation: { summary: {
        conflicts: 1, totalIssues: 2, historyGaps: 2,
        blockingHistoryGaps: 1, historicalBaselines: 1,
      } },
    });
  });

  it("uses the first projection timestamp and exact external receipt to accept only a pre-projection mirror baseline", async () => {
    const db = {
      prepare: (sql) => ({ bind: () => ({
        first: async () => ({ count: 1, cutover_at: "2026-08-09T03:45:57.994Z" }),
        all: async () => ({ results: sql.includes("appointment_projection_events") ? [{
          id: "event-observed", provider: "ghl", source_kind: "webhook",
          provider_event_id: "event-observed", provider_event_type: "AppointmentCreate",
          provider_appointment_id: "observed-appointment", provider_status_raw: "confirmed",
          normalized_status: "confirmed", starts_at: "2026-08-10T17:00:00.000Z",
          ends_at: "2026-08-10T17:50:00.000Z", timezone: "America/Los_Angeles",
          observed_at: "2026-08-09T03:45:57.994Z", evidence_hash: "observed-hash",
        }] : [
          {
            provider_appointment_id: "observed-appointment", provider_status_raw: "confirmed",
            status: "confirmed", starts_at: "2026-08-10T17:00:00.000Z",
            ends_at: "2026-08-10T17:50:00.000Z", timezone: "America/Los_Angeles",
          },
          {
            provider_appointment_id: "legacy-appointment", status: "confirmed",
            authority: "provider_mirror", provider_sync_state: "synced",
            updated_at: "2026-08-07T23:45:11.899Z",
            appointment_last_seen_at: "2026-08-07T23:45:11.899Z",
          },
        ] }),
      }) }),
    };

    await expect(appointmentProjectionReadiness(db, "2026-08-29T14:37:21.190Z")).resolves.toMatchObject({
      state: "baseline_ready",
      reconciliation: {
        summary: {
          conflicts: 0,
          historicalBaselines: 1,
          stateCounts: { baseline: 1, matched: 1, unobserved: 0 },
        },
        records: expect.arrayContaining([expect.objectContaining({
          providerAppointmentId: "legacy-appointment", state: "baseline", observationCount: 0,
        })]),
      },
    });
  });
});
