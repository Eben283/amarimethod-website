import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ghlFetch: vi.fn(),
  fetchGarrettScheduleEvents: vi.fn(),
  createConfirmedAppointment: vi.fn(),
}));

vi.mock("./ghl.js", () => ({ ghlFetch: mocks.ghlFetch }));
vi.mock("./app-owned-buffer.js", () => ({ fetchGarrettScheduleEvents: mocks.fetchGarrettScheduleEvents }));
vi.mock("./ghl-appointment-handoff.js", () => ({ createConfirmedAppointment: mocks.createConfirmedAppointment }));

import { createGhlStaffCalendarProvider } from "./staff-calendar-provider-ghl.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("temporary GHL Staff calendar adapter", () => {
  it("keeps GHL request construction out of the Staff API, UI, and command domain", () => {
    const api = readFileSync(new URL("../api/staff-appointments.js", import.meta.url), "utf8");
    const ui = readFileSync(new URL("../../staff/src/components/ManageAppointmentSheet.tsx", import.meta.url), "utf8");
    const domain = readFileSync(new URL("./staff-appointment-manage.js", import.meta.url), "utf8");
    expect(api).not.toContain("services.leadconnectorhq.com");
    expect(api).not.toContain('from "../lib/ghl.js"');
    expect(ui).not.toContain("providerContactId");
    expect(domain).not.toContain("services.leadconnectorhq.com");
  });

  it("pins appointment reads to the server-resolved provider contact", async () => {
    mocks.ghlFetch.mockResolvedValue(new Response(JSON.stringify({ appointments: [{ id: "appt_1" }] }), { status: 200 }));
    const provider = createGhlStaffCalendarProvider({ env: {} }, "ghl_authoritative");

    await expect(provider.listContactAppointments("browser_authored")).resolves.toEqual([{ id: "appt_1" }]);
    expect(mocks.ghlFetch).toHaveBeenCalledWith(
      expect.anything(),
      "https://services.leadconnectorhq.com/contacts/ghl_authoritative/appointments",
    );
  });

  it("translates an owned booking decision without accepting command contact identity", async () => {
    mocks.ghlFetch.mockResolvedValue(new Response(JSON.stringify({ contact: {
      firstName: "Alex", lastName: "River", email: "alex@example.test", phone: "+14155550100",
    } }), { status: 200 }));
    mocks.createConfirmedAppointment.mockImplementation(async (input) => ({ id: "appt_new", input }));
    const provider = createGhlStaffCalendarProvider({ env: {} }, "ghl_authoritative");

    const result = await provider.createAppointment({
      contactId: "browser_authored",
      booking: {
        calendarId: "EM6vB2mq7EAdGCbUb3j1",
        durationMinutes: 50,
        title: "Amari Method Assessment",
      },
      startTime: "2026-09-01T10:00:00-07:00",
      timezone: "America/Los_Angeles",
    });

    expect(result.input.payload).toMatchObject({
      contactId: "ghl_authoritative",
      calendarId: "EM6vB2mq7EAdGCbUb3j1",
      locationId: "7pIO7FHVAyBT1jKGhfQM",
      startTime: "2026-09-01T10:00:00-07:00",
      endTime: "2026-09-01T10:50:00-07:00",
      title: "Amari Method Assessment",
      toNotify: true,
      ignoreDateRange: false,
      firstName: "Alex",
    });
  });

  it("keeps replacement notification semantics inside the compatibility adapter", async () => {
    mocks.ghlFetch.mockResolvedValue(new Response(JSON.stringify({ contact: { firstName: "Alex" } }), { status: 200 }));
    mocks.createConfirmedAppointment.mockImplementation(async (input) => ({ id: "replacement", input }));
    const provider = createGhlStaffCalendarProvider({ env: {} }, "ghl_authoritative");

    const result = await provider.createReplacement({
      original: { calendarId: "EM6vB2mq7EAdGCbUb3j1", title: "Assessment" },
      startTime: "2026-09-02T13:00:00-07:00",
      timezone: "America/Los_Angeles",
    });

    expect(result.input.payload).toMatchObject({
      contactId: "ghl_authoritative",
      calendarId: "EM6vB2mq7EAdGCbUb3j1",
      title: "Assessment",
      toNotify: false,
    });
  });

  it("refuses construction without an exact provider crosswalk", () => {
    expect(() => createGhlStaffCalendarProvider({ env: {} }, "")).toThrow(/provider contact identity/);
  });
});
