import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOwnedAppointmentSchedule, staffScheduleDetails, staffScheduleSummaries } from "./staff-owned-appointment-schedule.js";

afterEach(() => vi.unstubAllGlobals());

describe("Staff owned appointment schedule", () => {
  it("reads the authenticated owned range and keeps owned identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      source: "owned_crm",
      truth: { authoritative: 1, propagating: 0, mirrored: 0, degraded: 0 },
      appointments: [{
        id: "appt-owned", contactId: "contact-owned", contactName: "Partner Person",
        serviceName: "Partner Initial Session", startTime: "2026-09-01T17:00:00.000Z",
        endTime: "2026-09-01T18:00:00.000Z", status: "confirmed", authority: "owned",
        providerSyncState: "synced", truthState: "authoritative", providerAppointmentId: "ghl-1",
        providerCalendarId: "calendar-1",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const schedule = await fetchOwnedAppointmentSchedule({ env: { WORKER_AUTH_SECRET: "secret" } }, {
      startTime: Date.parse("2026-09-01T00:00:00Z"), endTime: Date.parse("2026-09-02T00:00:00Z"),
    });
    expect(staffScheduleSummaries(schedule)[0]).toMatchObject({
      id: "appt-owned", contactId: "contact-owned", truthState: "authoritative",
      providerAppointmentId: "ghl-1",
    });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });

  it("normalizes naive Pacific appointment times before sending them to Staff browsers", () => {
    const appointment = {
      id: "appt-naive", contactId: "contact-owned", contactName: "Partner Person",
      serviceName: "Partner Initial Session", startTime: "2026-09-07T12:00:00",
      endTime: "2026-09-07T13:00:00", status: "confirmed", authority: "mirror",
      providerSyncState: "synced", truthState: "mirrored", providerAppointmentId: "ghl-1",
      providerCalendarId: "calendar-1",
    };

    const [summary] = staffScheduleSummaries({ appointments: [appointment] });
    expect(summary.startTime).toBe("2026-09-07T12:00:00-07:00");
    expect(summary.endTime).toBe("2026-09-07T13:00:00-07:00");

    const [detail] = staffScheduleDetails({
      detailIncluded: true,
      appointments: [{
        ...appointment,
        meetingLocation: null, sessionsRemaining: 0, sessionsCompleted: 0,
        seriesType: "none", tags: [], sessionPrepaid: false, paymentStatus: "unknown",
        paymentMethod: null, paymentNote: null, enrichmentFailed: false, detailTruth: {},
      }],
    });
    expect(detail.startTime).toBe("2026-09-07T12:00:00-07:00");
    expect(detail.endTime).toBe("2026-09-07T13:00:00-07:00");
  });

  it("maps detailed owned evidence without inventing missing payment truth", () => {
    const detail = staffScheduleDetails({
      detailIncluded: true,
      appointments: [{
        id: "appt-owned", contactId: "contact-owned", contactName: "Partner Person",
        serviceName: "Partner Initial Session", startTime: "2026-09-01T17:00:00.000Z",
        endTime: "2026-09-01T18:00:00.000Z", status: "confirmed", authority: "owned",
        providerSyncState: "pending", truthState: "propagating", providerAppointmentId: null,
        providerCalendarId: null, meetingLocation: null, sessionsRemaining: 0, sessionsCompleted: 0,
        seriesType: "none", tags: ["affiliate-partner"], sessionPrepaid: false,
        paymentStatus: "unknown", paymentMethod: null, paymentNote: null, enrichmentFailed: false,
        detailTruth: {
          overall: "partial", sessionBalance: "provider_mirror", series: "unknown",
          payment: "unknown", meetingLocation: "unknown",
        },
      }],
    });
    expect(detail[0]).toMatchObject({
      id: "appt-owned", paymentStatus: "unknown", sessionPrepaid: false,
      detailTruth: { overall: "partial", payment: "unknown" },
    });
  });

  it("does not fall back when owned truth is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(fetchOwnedAppointmentSchedule({ env: { WORKER_AUTH_SECRET: "secret" } }, {
      startTime: 0, endTime: 1,
    })).rejects.toThrow(/failed \(503\)/i);
  });
});
