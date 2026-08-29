import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnedAppointmentScheduleStore } from "./staff-owned-appointment-store.js";

afterEach(() => vi.unstubAllGlobals());

describe("Staff owned appointment schedule store", () => {
  it("captures, leases, checkpoints, and completes under owned identity", async () => {
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.action === "schedule") return new Response(JSON.stringify({ appointment: {
        commandId: "acmd_1234567890abcdef12345678",
        appointmentId: "appt_1234567890abcdef12345678",
      } }), { status: 201, headers: { "Content-Type": "application/json" } });
      if (body.action === "claim") return new Response(JSON.stringify({
        state: "acquired", execution: { providerRecordId: null },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ execution: { state: body.action === "complete" ? "completed" : "executing" } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const store = createOwnedAppointmentScheduleStore({ env: { WORKER_AUTH_SECRET: "secret" } }, {
      actor: "Garrett", contactId: "contact-1", idempotencyKey: "partner-session-1",
      startTime: "2026-09-01T10:00:00-07:00", timezone: "America/Los_Angeles",
      booking: { serviceId: "partner-initial", calendarId: "calendar-1" },
    });

    await expect(store.claim()).resolves.toMatchObject({
      state: "acquired",
      operation: { appointmentId: null, ownedAppointmentId: "appt_1234567890abcdef12345678" },
    });
    await store.checkpointAppointment("ghl-appointment-1");
    const canonical = store.canonicalResult({ appointmentId: "ghl-appointment-1", appointmentStatus: "confirmed" });
    expect(canonical).toMatchObject({
      appointmentId: "appt_1234567890abcdef12345678",
      providerAppointmentId: "ghl-appointment-1",
      authority: "owned",
    });
    await store.complete(canonical);
    expect(requests.map((request) => request.action)).toEqual(["schedule", "claim", "provider-link", "complete"]);
    expect(requests[0]).not.toHaveProperty("calendarId");
    expect(requests[2]).toMatchObject({ provider: "ghl", providerCalendarId: "calendar-1" });
  });

  it("fails closed without Worker credentials", async () => {
    const store = createOwnedAppointmentScheduleStore({ env: {} }, {
      actor: "Garrett", contactId: "contact-1", idempotencyKey: "partner-session-1",
      startTime: "2026-09-01T10:00:00-07:00", timezone: "America/Los_Angeles",
      booking: { serviceId: "partner-initial", calendarId: "calendar-1" },
    });
    await expect(store.claim()).rejects.toMatchObject({ code: "owned_appointment_unavailable", status: 503 });
  });
});
