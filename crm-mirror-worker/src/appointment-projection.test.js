import { describe, expect, it } from "vitest";
import {
  appointmentBufferReadiness,
  deriveAppointmentTransition,
  reconcileAppointmentProjection,
} from "./appointment-projection.js";

function event(overrides = {}) {
  return {
    id: "event-1",
    provider: "ghl",
    source_kind: "webhook",
    provider_event_id: "provider-event-1",
    provider_event_type: "AppointmentCreate",
    provider_appointment_id: "appointment-1",
    provider_contact_id: "contact-1",
    provider_calendar_id: "calendar-1",
    provider_status_raw: "confirmed",
    normalized_status: "confirmed",
    starts_at: "2026-08-10T17:00:00.000Z",
    ends_at: "2026-08-10T17:50:00.000Z",
    timezone: "America/Los_Angeles",
    provider_occurred_at: "2026-08-08T17:00:00.000Z",
    observed_at: "2026-08-08T17:00:01.000Z",
    evidence_hash: "hash-1",
    ...overrides,
  };
}

describe("owned appointment projection", () => {
  it("models create, reschedule, status, and cancellation without losing provider evidence", () => {
    const created = deriveAppointmentTransition(null, event());
    const rescheduledObservation = event({
      id: "event-2",
      provider_event_id: "provider-event-2",
      provider_event_type: "AppointmentUpdate",
      starts_at: "2026-08-10T18:00:00.000Z",
      ends_at: "2026-08-10T18:50:00.000Z",
      evidence_hash: "hash-2",
    });
    const rescheduled = deriveAppointmentTransition(created.current, rescheduledObservation);
    const showed = deriveAppointmentTransition(rescheduled.current, event({
      id: "event-3",
      provider_event_id: "provider-event-3",
      provider_event_type: "AppointmentUpdate",
      normalized_status: "attended",
      provider_status_raw: "showed",
      starts_at: rescheduledObservation.starts_at,
      ends_at: rescheduledObservation.ends_at,
      evidence_hash: "hash-3",
    }));
    const cancelled = deriveAppointmentTransition(showed.current, event({
      id: "event-4",
      provider_event_id: "provider-event-4",
      provider_event_type: "AppointmentUpdate",
      normalized_status: "cancelled",
      provider_status_raw: "cancelled",
      starts_at: rescheduledObservation.starts_at,
      ends_at: rescheduledObservation.ends_at,
      evidence_hash: "hash-4",
    }));

    expect([created.transition, rescheduled.transition, showed.transition, cancelled.transition])
      .toEqual(["create", "reschedule", "status", "cancel"]);
    expect(cancelled.current).toMatchObject({
      providerAppointmentId: "appointment-1",
      providerEventId: "provider-event-4",
      evidenceHash: "hash-4",
      status: "cancelled",
      startsAt: "2026-08-10T18:00:00.000Z",
    });
  });

  it("is idempotent for repeated evidence and surfaces provider event collisions and shadow lag", () => {
    const first = event();
    const duplicate = { ...first, id: "duplicate-row" };
    const collision = event({ id: "collision", evidence_hash: "different-hash", starts_at: "2026-08-10T19:00:00.000Z" });
    const result = reconcileAppointmentProjection({
      events: [first, duplicate, collision],
      currentAppointments: [{
        provider_appointment_id: "appointment-1",
        provider_calendar_id: "calendar-1",
        provider_status_raw: "confirmed",
        status: "confirmed",
        starts_at: "2026-08-10T20:00:00.000Z",
        ends_at: "2026-08-10T20:50:00.000Z",
        timezone: "America/Los_Angeles",
      }],
    });

    expect(result.summary).toMatchObject({ appointments: 1, observations: 2, conflicts: 2 });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "provider_event_collision",
      "shadow_current_mismatch",
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ providerAppointmentId: "appointment-1", state: "mismatch", observationCount: 2 }),
    ]);
  });

  it("reports a missing create as a gap instead of inventing history", () => {
    const result = reconcileAppointmentProjection({
      events: [event({ provider_event_type: "AppointmentUpdate", normalized_status: "cancelled", provider_status_raw: "cancelled" })],
      currentAppointments: [],
    });

    expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing_create", providerAppointmentId: "appointment-1" }));
    expect(result.appointments[0]).toMatchObject({ transition: "cancel", status: "cancelled", historyComplete: false });
    expect(result.summary).toMatchObject({ conflicts: 2, historyGaps: 2, blockingHistoryGaps: 2, historicalBaselines: 0 });
  });
});

describe("appointment buffer readiness evidence", () => {
  it("does not silently choose between the runtime 20-minute rule and older 10-minute evidence", () => {
    expect(appointmentBufferReadiness()).toEqual({
      state: "confirmed",
      runtimeAppOwnedMinutes: 20,
      historicalDocumentedMinutes: 10,
      blocksWriteAuthority: false,
      evidence: [
        "functions/lib/booking-slot-policy.js",
        "ops/memory/project_native_booking.md",
        "ops/memory/ghl_calendars_source_of_truth.md",
      ],
      note: "20-minute turnover is confirmed. The 10-minute booking/calendar references are historical evidence only; appointment-history reconciliation remains a separate write-authority gate.",
    });
  });

  it("classifies every current appointment without treating a snapshot as its original booking", () => {
    const result = reconcileAppointmentProjection({
      events: [event({ provider_event_type: "sync_initial", source_kind: "snapshot" })],
      currentAppointments: [
        {
          provider_appointment_id: "appointment-1", provider_calendar_id: "calendar-1", provider_status_raw: "confirmed",
          status: "confirmed", starts_at: "2026-08-10T17:00:00.000Z", ends_at: "2026-08-10T17:50:00.000Z", timezone: "America/Los_Angeles",
        },
        {
          provider_appointment_id: "appointment-2", provider_calendar_id: "calendar-1", provider_status_raw: "confirmed",
          status: "confirmed", starts_at: "2026-08-11T17:00:00.000Z", ends_at: "2026-08-11T17:50:00.000Z", timezone: "America/Los_Angeles",
        },
      ],
    });

    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerAppointmentId: "appointment-1", state: "baseline", historyComplete: false }),
      expect.objectContaining({ providerAppointmentId: "appointment-2", state: "unobserved", observationCount: 0 }),
    ]));
    expect(result.summary.stateCounts).toMatchObject({ baseline: 1, unobserved: 1, matched: 0, mismatch: 0, orphaned: 0 });
    expect(result.summary).toMatchObject({
      conflicts: 1,
      totalIssues: 2,
      historyGaps: 2,
      blockingHistoryGaps: 1,
      historicalBaselines: 1,
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "missing_create",
      sourceKind: "snapshot",
      firstProviderEventType: "sync_initial",
      blocking: false,
    }));
  });

  it("accepts an exact sync-initial snapshot as cutover baseline without claiming complete history", () => {
    const result = reconcileAppointmentProjection({
      events: [event({ provider_event_type: "sync_initial", source_kind: "snapshot" })],
      currentAppointments: [{
        provider_appointment_id: "appointment-1", provider_calendar_id: "calendar-1", provider_status_raw: "confirmed",
        status: "confirmed", starts_at: "2026-08-10T17:00:00.000Z", ends_at: "2026-08-10T17:50:00.000Z", timezone: "America/Los_Angeles",
      }],
    });

    expect(result.records[0]).toMatchObject({ state: "baseline", historyComplete: false });
    expect(result.summary).toMatchObject({
      conflicts: 0,
      totalIssues: 1,
      historyGaps: 1,
      blockingHistoryGaps: 0,
      historicalBaselines: 1,
    });
  });

  it("accepts an exact pre-projection provider-mirror receipt as an incomplete cutover baseline", () => {
    const result = reconcileAppointmentProjection({
      projectionCutoverAt: "2026-08-09T03:45:57.994Z",
      currentAppointments: [{
        provider_appointment_id: "legacy-appointment", provider_calendar_id: "calendar-1",
        provider_status_raw: "confirmed", status: "confirmed",
        starts_at: "2026-08-10T13:00:00.000Z", ends_at: "2026-08-10T13:50:00.000Z",
        timezone: null, authority: "provider_mirror", provider_sync_state: "synced",
        updated_at: "2026-08-07T23:45:11.899Z",
        appointment_last_seen_at: "2026-08-07T23:45:11.899Z",
      }],
    });

    expect(result.records).toContainEqual(expect.objectContaining({
      providerAppointmentId: "legacy-appointment",
      state: "baseline",
      historyComplete: false,
      observationCount: 0,
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "missing_shadow_observation",
      providerAppointmentId: "legacy-appointment",
      blocking: false,
      baselineKind: "preprojection_provider_mirror",
    }));
    expect(result.summary).toMatchObject({
      conflicts: 0,
      totalIssues: 1,
      historyGaps: 1,
      blockingHistoryGaps: 0,
      historicalBaselines: 1,
    });
  });

  it.each([
    ["receipt timestamp differs", { appointment_last_seen_at: "2026-08-07T23:45:12.000Z" }],
    ["mirror update is post-cutover", { updated_at: "2026-08-10T00:00:00.000Z", appointment_last_seen_at: "2026-08-10T00:00:00.000Z" }],
    ["appointment is owned", { authority: "owned" }],
    ["provider mirror is not synced", { provider_sync_state: "manual_review" }],
  ])("keeps an unobserved mirror blocking when %s", (_label, override) => {
    const result = reconcileAppointmentProjection({
      projectionCutoverAt: "2026-08-09T03:45:57.994Z",
      currentAppointments: [{
        provider_appointment_id: "legacy-appointment", status: "confirmed",
        authority: "provider_mirror", provider_sync_state: "synced",
        updated_at: "2026-08-07T23:45:11.899Z",
        appointment_last_seen_at: "2026-08-07T23:45:11.899Z",
        ...override,
      }],
    });

    expect(result.records[0]).toMatchObject({ state: "unobserved", historyComplete: false });
    expect(result.summary).toMatchObject({
      conflicts: 1,
      blockingHistoryGaps: 1,
      historicalBaselines: 0,
    });
  });
});
