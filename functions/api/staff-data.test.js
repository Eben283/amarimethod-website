import { beforeEach, describe, expect, it, vi } from "vitest";

describe("staff-data calendar loading", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("loads calendar summaries from owned CRM without provider or ledger reads", async () => {
    const ghlFetch = vi.fn(async (_context, url) => { throw new Error(`summary request should not fetch ${url}`); });
    const fetchOwnedAppointmentSchedule = vi.fn(async () => ({
      source: "owned_crm",
      truth: { authoritative: 1, propagating: 0, mirrored: 0, degraded: 0 },
      appointments: [],
    }));
    const staffScheduleSummaries = vi.fn(() => [{
      id: "appt-owned-1", calendarId: "cal-1", contactId: "contact-owned-1",
      contactName: "Surrina", startTime: "2026-08-08T18:00:00.000Z",
      endTime: "2026-08-08T19:00:00.000Z", title: "Partner Initial Session",
      calendarName: "Partner Initial Session", appointmentStatus: "confirmed",
      sessionsRemaining: 0, sessionsCompleted: 0, seriesType: "none", tags: [],
      sessionPrepaid: false, truthState: "authoritative",
    }]);
    const staffScheduleDetails = vi.fn(() => [{
      id: "appt-owned-detail-1", paymentStatus: "unknown", detailTruth: { overall: "partial" },
    }]);

    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "Eben" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
    }));
    vi.doMock("../lib/ghl.js", () => ({
      getGhlToken: vi.fn(async () => "token"),
      ghlFetch,
      ghlHeaders: vi.fn(),
    }));
    vi.doMock("../lib/staff-owned-appointment-schedule.js", () => ({
      fetchOwnedAppointmentSchedule,
      staffScheduleDetails,
      staffScheduleSummaries,
    }));

    const { onRequestGet } = await import("./staff-data.js");
    const request = onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-data?date=2026-08-03&endDate=2026-08-09&summary=1"),
      env: { WORKER_AUTH_SECRET: "secret" },
    });
    const response = await request;

    expect(response.status).toBe(200);
    expect(fetchOwnedAppointmentSchedule).toHaveBeenCalledOnce();
    expect(ghlFetch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: "appt-owned-1",
        contactId: "contact-owned-1",
        contactName: "Surrina",
        truthState: "authoritative",
      }),
    ]);

    const detailResponse = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-data?date=2026-08-03"),
      env: { WORKER_AUTH_SECRET: "secret" },
    });
    expect(detailResponse.status).toBe(200);
    expect(staffScheduleDetails).toHaveBeenCalledOnce();
    expect(await detailResponse.json()).toEqual([
      expect.objectContaining({ id: "appt-owned-detail-1", paymentStatus: "unknown" }),
    ]);
    expect(ghlFetch).not.toHaveBeenCalled();
  });
});
