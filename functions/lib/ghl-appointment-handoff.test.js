import { describe, expect, it, vi } from "vitest";
import { AppointmentHandoffError, createConfirmedAppointment } from "./ghl-appointment-handoff.js";

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe("createConfirmedAppointment", () => {
  it("creates new, then confirms through a separate status transition", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ appointment: { id: "appt_1" } }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const result = await createConfirmedAppointment({
      request,
      endpoint: "https://example.test/calendars/events/appointments",
      payload: { calendarId: "cal_1", appointmentStatus: "confirmed", startTime: "2026-08-18T10:00:00-07:00" },
    });

    expect(JSON.parse(request.mock.calls[0][1].body).appointmentStatus).toBe("new");
    expect(request.mock.calls[1]).toEqual([
      "https://example.test/calendars/events/appointments/appt_1",
      { method: "PUT", body: JSON.stringify({ appointmentStatus: "confirmed" }) },
    ]);
    expect(result).toMatchObject({ id: "appt_1", appointmentStatus: "confirmed" });
  });

  it("cancels the new appointment if confirmation fails", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "appt_2" }))
      .mockResolvedValueOnce(new Response("confirm failed", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    await expect(createConfirmedAppointment({ request, endpoint: "https://example.test/appointments", payload: {} }))
      .rejects.toMatchObject({
        name: "AppointmentHandoffError",
        phase: "confirm",
        appointmentId: "appt_2",
        cleanupStatus: 200,
      });
    expect(JSON.parse(request.mock.calls[2][1].body).appointmentStatus).toBe("cancelled");
  });

  it("surfaces create failures without attempting a status update", async () => {
    const request = vi.fn().mockResolvedValue(new Response("slot unavailable", { status: 400 }));
    await expect(createConfirmedAppointment({ request, endpoint: "https://example.test/appointments", payload: {} }))
      .rejects.toBeInstanceOf(AppointmentHandoffError);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
