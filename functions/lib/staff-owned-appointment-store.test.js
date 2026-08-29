import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnedAppointmentManageStore, createOwnedAppointmentScheduleStore } from "./staff-owned-appointment-store.js";

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

describe("Staff owned appointment manage store", () => {
  it("captures owned reschedule intent before checkpointing the temporary provider replacement", async () => {
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.action === "manage") return new Response(JSON.stringify({ command: {
        commandId: "acmd_1234567890abcdef12345678",
      } }), { status: 201, headers: { "Content-Type": "application/json" } });
      if (body.action === "claim") return new Response(JSON.stringify({
        state: "acquired", execution: { providerRecordId: null },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (body.action === "complete") return new Response(JSON.stringify({ execution: {
        state: "completed",
        result: {
          appointmentId: "owned-source",
          replacementAppointmentId: "owned-replacement",
          providerReplacementAppointmentId: "ghl-replacement",
        },
      } }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ execution: { state: "executing" } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const store = createOwnedAppointmentManageStore({ env: { WORKER_AUTH_SECRET: "secret" } }, {
      actor: "Garrett", action: "reschedule", contactId: "owned-contact",
      appointmentId: "owned-source", providerCalendarId: "calendar-1",
      timezone: "America/Los_Angeles",
    });

    const claim = await store.claim({
      idempotencyKey: "reschedule-owned-source",
      requestedStartTime: "2026-09-04T10:15:00-07:00",
    });
    expect(claim).toMatchObject({ state: "acquired", command: { replacementAppointmentId: null } });
    await store.checkpointReplacement(claim.command.id, "ghl-replacement");
    const completion = await store.complete(claim.command.id, {
      appointmentId: "owned-source", replacementAppointmentId: "ghl-replacement",
    });
    expect(store.canonicalResult({}, completion)).toMatchObject({
      appointmentId: "owned-source",
      replacementAppointmentId: "owned-replacement",
      providerReplacementAppointmentId: "ghl-replacement",
    });
    expect(requests.map((request) => request.action)).toEqual(["manage", "claim", "provider-link", "complete"]);
    expect(requests[0]).toMatchObject({
      manageAction: "reschedule", appointmentId: "owned-source",
      contactId: "owned-contact", startTime: "2026-09-04T10:15:00-07:00",
    });
    expect(requests[2]).toMatchObject({ providerCalendarId: "calendar-1", providerRecordId: "ghl-replacement" });
  });
});
