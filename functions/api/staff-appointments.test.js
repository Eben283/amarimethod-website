import { beforeEach, describe, expect, it, vi } from "vitest";

describe("staff appointment management API", () => {
  beforeEach(() => vi.resetModules());

  it("returns Garrett's internal availability without calling public free slots", async () => {
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.amarimethod.com" }),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "availability", contactId: "contact_1", appointmentId: "appt_1",
          startDate: "2026-08-12", endDate: "2026-08-12",
        },
        error: null,
      })),
    }));
    const ghlFetch = vi.fn(async (_context, url) => {
      const value = String(url);
      if (value.includes("/contacts/contact_1/appointments")) return new Response(JSON.stringify({ appointments: [{
        id: "appt_1", contactId: "contact_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
        title: "Amari Assessment", appointmentStatus: "confirmed",
        startTime: "2026-08-14T13:00:00-07:00", endTime: "2026-08-14T13:50:00-07:00",
      }] }), { status: 200 });
      if (value.includes("/calendars/events?")) return new Response(JSON.stringify({ events: [] }), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    vi.doMock("../lib/ghl.js", () => ({ ghlFetch }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: { JWT_SECRET: "test" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.publicRestrictionsApplied).toBe(false);
    expect(body.slots.some((slot) => slot.datetime === "2026-08-12T10:15:00-07:00")).toBe(true);
    expect(ghlFetch.mock.calls.some((call) => String(call[1]).includes("free-slots"))).toBe(false);
  });

  it("rejects browser-authored calendar and status identity", async () => {
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Eben" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "cancel", contactId: "contact_1", appointmentId: "appt_1",
          idempotencyKey: "cancel-appt-1", appointmentStatus: "cancelled",
        },
        error: null,
      })),
    }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: {},
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Appointment identity and status are controlled by the server." });
  });

  it("passes a cancellation through the durable command boundary with the signed actor", async () => {
    const manageAppointmentCommand = vi.fn(async (input) => ({
      status: "completed", action: "cancel", actor: input.actor,
      appointmentId: input.appointmentId, contactId: input.contactId,
      previousStartTime: "2026-08-14T10:00:00-07:00",
      appointmentStatus: "cancelled", reminderVerification: "pending_event_evidence",
    }));
    const store = { marker: "durable-store" };
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: { action: "cancel", contactId: "contact_1", appointmentId: "appt_1", idempotencyKey: "cancel-appt-1" },
        error: null,
      })),
    }));
    vi.doMock("../lib/appointment-command-store.js", () => ({ createAppointmentCommandStore: vi.fn(() => store) }));
    vi.doMock("../lib/staff-appointment-manage.js", async (importOriginal) => ({
      ...(await importOriginal()), manageAppointmentCommand,
    }));
    vi.doMock("../lib/ops-path-emit.js", () => ({ emitPathHop: vi.fn(async () => ({})) }));
    vi.doMock("../lib/ops-alert.js", () => ({ recordOpsError: vi.fn(async () => ({})) }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: { ATTEND_DB: {} },
      waitUntil: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(manageAppointmentCommand).toHaveBeenCalledWith(expect.objectContaining({
      actor: "Garrett", action: "cancel", contactId: "contact_1", appointmentId: "appt_1", store,
    }));
  });
});
