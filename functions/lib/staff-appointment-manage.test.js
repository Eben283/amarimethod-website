import { describe, expect, it } from "vitest";
import { internalAvailability, manageAppointmentCommand } from "./staff-appointment-manage.js";

describe("Staff appointment management", () => {
  it("shows every collision-free internal start instead of public-facing choices", () => {
    const slots = internalAvailability({
      calendarId: "EM6vB2mq7EAdGCbUb3j1",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      events: [{
        id: "existing",
        calendarId: "EM6vB2mq7EAdGCbUb3j1",
        appointmentStatus: "confirmed",
        startTime: "2026-08-10T13:00:00-07:00",
        endTime: "2026-08-10T13:50:00-07:00",
      }],
      now: Date.parse("2026-08-10T09:00:00-07:00"),
    });

    expect(slots.map((slot) => slot.datetime)).toContain("2026-08-10T10:15:00-07:00");
    expect(slots.map((slot) => slot.datetime)).not.toContain("2026-08-10T12:15:00-07:00");
    expect(slots.map((slot) => slot.datetime)).not.toContain("2026-08-10T13:45:00-07:00");
    expect(slots.map((slot) => slot.datetime)).toContain("2026-08-10T14:15:00-07:00");
  });
});

describe("manageAppointmentCommand", () => {
  it("cancels the exact owned future appointment once and records the actor", async () => {
    const completed = [];
    const store = {
      claim: async () => ({ state: "acquired", command: { id: "cmd_1", replacementAppointmentId: null } }),
      complete: async (_commandId, result) => { completed.push(result); },
      fail: async () => {},
      checkpointReplacement: async () => {},
    };
    let appointment = {
      id: "appt_1",
      contactId: "contact_1",
      calendarId: "EM6vB2mq7EAdGCbUb3j1",
      title: "Amari Assessment",
      appointmentStatus: "confirmed",
      startTime: "2026-08-12T10:00:00-07:00",
      endTime: "2026-08-12T10:50:00-07:00",
    };
    const provider = {
      listContactAppointments: async () => [appointment],
      cancelAppointment: async () => { appointment = { ...appointment, appointmentStatus: "cancelled" }; },
    };

    const result = await manageAppointmentCommand({
      actor: "Garrett",
      action: "cancel",
      contactId: "contact_1",
      appointmentId: "appt_1",
      idempotencyKey: "cancel-appt-1",
      store,
      provider,
      now: Date.parse("2026-08-10T09:00:00-07:00"),
    });

    expect(result).toMatchObject({ status: "completed", action: "cancel", appointmentId: "appt_1", actor: "Garrett" });
    expect(completed).toHaveLength(1);
  });

  it("reschedules into any free internal start before cancelling the old appointment", async () => {
    const order = [];
    let appointments = [{
      id: "old_1", contactId: "contact_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
      title: "Amari Assessment", appointmentStatus: "confirmed",
      startTime: "2026-08-12T13:00:00-07:00", endTime: "2026-08-12T13:50:00-07:00",
    }];
    const store = {
      claim: async () => ({ state: "acquired", command: { id: "cmd_2", replacementAppointmentId: null } }),
      checkpointReplacement: async (_id, replacementId) => order.push(`checkpoint:${replacementId}`),
      complete: async () => {},
      fail: async () => {},
    };
    const provider = {
      listContactAppointments: async () => appointments,
      listSchedule: async () => appointments,
      createReplacement: async ({ startTime, onCreated }) => {
        order.push("create:new_1");
        const replacement = { ...appointments[0], id: "new_1", startTime, endTime: "2026-08-12T11:05:00-07:00" };
        appointments = [...appointments, replacement];
        await onCreated(replacement.id);
        return replacement;
      },
      cancelAppointment: async (appointment) => {
        order.push(`cancel:${appointment.id}`);
        appointments = appointments.map((item) => item.id === appointment.id ? { ...item, appointmentStatus: "cancelled" } : item);
      },
    };

    const result = await manageAppointmentCommand({
      actor: "Eben", action: "reschedule", contactId: "contact_1", appointmentId: "old_1",
      idempotencyKey: "reschedule-old-1", startTime: "2026-08-12T10:15:00-07:00",
      timezone: "America/Los_Angeles", store, provider,
      now: Date.parse("2026-08-10T09:00:00-07:00"),
    });

    expect(order).toEqual(["create:new_1", "checkpoint:new_1", "cancel:old_1"]);
    expect(result).toMatchObject({
      status: "completed", action: "reschedule", appointmentId: "old_1",
      replacementAppointmentId: "new_1", newStartTime: "2026-08-12T10:15:00-07:00",
    });
  });

  it("cancels the replacement and keeps the original when the old cancellation fails", async () => {
    const order = [];
    let appointments = [{
      id: "old_2", contactId: "contact_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
      title: "Amari Assessment", appointmentStatus: "confirmed",
      startTime: "2026-08-13T13:00:00-07:00", endTime: "2026-08-13T13:50:00-07:00",
    }];
    const store = {
      claim: async () => ({ state: "acquired", command: { id: "cmd_3", replacementAppointmentId: null } }),
      checkpointReplacement: async () => {},
      clearReplacement: async () => order.push("clear:new_2"),
      complete: async () => {},
      fail: async () => {},
    };
    const provider = {
      listContactAppointments: async () => appointments,
      listSchedule: async () => appointments,
      createReplacement: async ({ startTime, onCreated }) => {
        const replacement = { ...appointments[0], id: "new_2", startTime, endTime: "2026-08-13T11:05:00-07:00" };
        appointments = [...appointments, replacement];
        await onCreated(replacement.id);
        return replacement;
      },
      cancelAppointment: async (appointment) => {
        order.push(`cancel:${appointment.id}`);
        if (appointment.id === "old_2") throw new Error("provider rejected old cancellation");
        appointments = appointments.map((item) => item.id === appointment.id ? { ...item, appointmentStatus: "cancelled" } : item);
      },
    };

    await expect(manageAppointmentCommand({
      actor: "Garrett", action: "reschedule", contactId: "contact_1", appointmentId: "old_2",
      idempotencyKey: "reschedule-old-2", startTime: "2026-08-13T10:15:00-07:00",
      timezone: "America/Los_Angeles", store, provider,
      now: Date.parse("2026-08-10T09:00:00-07:00"),
    })).rejects.toThrow("original appointment stayed unchanged");

    expect(order).toEqual(["cancel:old_2", "cancel:new_2", "clear:new_2"]);
    expect(appointments.find((item) => item.id === "old_2").appointmentStatus).toBe("confirmed");
    expect(appointments.find((item) => item.id === "new_2").appointmentStatus).toBe("cancelled");
  });

  it("finishes an interrupted reschedule from provider readback without creating or cancelling twice", async () => {
    const completed = [];
    const appointments = [
      {
        id: "old_3", contactId: "contact_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
        title: "Amari Assessment", appointmentStatus: "cancelled",
        startTime: "2026-08-14T13:00:00-07:00", endTime: "2026-08-14T13:50:00-07:00",
      },
      {
        id: "new_3", contactId: "contact_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
        title: "Amari Assessment", appointmentStatus: "confirmed",
        startTime: "2026-08-14T10:15:00-07:00", endTime: "2026-08-14T11:05:00-07:00",
      },
    ];
    const store = {
      claim: async () => ({ state: "acquired", command: { id: "cmd_4", replacementAppointmentId: "new_3" } }),
      complete: async (_id, result) => completed.push(result),
      fail: async () => {},
    };
    const provider = {
      listContactAppointments: async () => appointments,
      listSchedule: async () => { throw new Error("schedule should not be read on completed provider state"); },
      createReplacement: async () => { throw new Error("replacement should not be created twice"); },
      cancelAppointment: async () => { throw new Error("appointment should not be cancelled twice"); },
    };

    const result = await manageAppointmentCommand({
      actor: "Eben", action: "reschedule", contactId: "contact_1", appointmentId: "old_3",
      idempotencyKey: "reschedule-old-3", startTime: "2026-08-14T10:15:00-07:00",
      timezone: "America/Los_Angeles", store, provider,
      now: Date.parse("2026-08-10T09:00:00-07:00"),
    });

    expect(result).toMatchObject({ status: "completed", replacementAppointmentId: "new_3" });
    expect(completed).toHaveLength(1);
  });

  it("clears a safely cancelled replacement checkpoint when provider confirmation fails", async () => {
    const cleared = [];
    const failure = Object.assign(new Error("provider confirmation failed"), {
      phase: "confirm", appointmentId: "new_4", cleanupStatus: 200,
    });
    const original = {
      id: "old_4", contactId: "contact_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
      title: "Amari Assessment", appointmentStatus: "confirmed",
      startTime: "2026-08-17T13:00:00-07:00", endTime: "2026-08-17T13:50:00-07:00",
    };
    const store = {
      claim: async () => ({ state: "acquired", command: { id: "cmd_5", replacementAppointmentId: null } }),
      checkpointReplacement: async () => {},
      clearReplacement: async (_id, replacementId) => cleared.push(replacementId),
      complete: async () => {},
      fail: async () => {},
    };
    const provider = {
      listContactAppointments: async () => [original],
      listSchedule: async () => [original],
      createReplacement: async ({ onCreated }) => { await onCreated("new_4"); throw failure; },
    };

    await expect(manageAppointmentCommand({
      actor: "Garrett", action: "reschedule", contactId: "contact_1", appointmentId: "old_4",
      idempotencyKey: "reschedule-old-4", startTime: "2026-08-17T10:15:00-07:00",
      store, provider, now: Date.parse("2026-08-10T09:00:00-07:00"),
    })).rejects.toThrow("provider confirmation failed");
    expect(cleared).toEqual(["new_4"]);
  });

  it("fails to manual review when a provider may have created an untracked replacement", async () => {
    let manualReview = false;
    const original = {
      id: "old_5", contactId: "contact_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
      title: "Amari Assessment", appointmentStatus: "confirmed",
      startTime: "2026-08-18T13:00:00-07:00", endTime: "2026-08-18T13:50:00-07:00",
    };
    const store = {
      claim: async () => ({ state: "acquired", command: { id: "cmd_6", replacementAppointmentId: null } }),
      checkpointReplacement: async () => {}, complete: async () => {},
      fail: async (_id, _error, options) => { manualReview = options.manualReview; },
    };
    const provider = {
      listContactAppointments: async () => [original],
      listSchedule: async () => [original],
      createReplacement: async () => { throw Object.assign(new Error("response had no appointment id"), { phase: "create" }); },
    };

    await expect(manageAppointmentCommand({
      actor: "Eben", action: "reschedule", contactId: "contact_1", appointmentId: "old_5",
      idempotencyKey: "reschedule-old-5", startTime: "2026-08-18T10:15:00-07:00",
      store, provider, now: Date.parse("2026-08-10T09:00:00-07:00"),
    })).rejects.toThrow("response had no appointment id");
    expect(manualReview).toBe(true);
  });
});
