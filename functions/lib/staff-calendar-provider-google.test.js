import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getGoogleToken: vi.fn(async () => "google-token") }));
vi.mock("./google-api.js", () => ({ getGoogleToken: mocks.getGoogleToken }));

import { createGoogleStaffCalendarProvider } from "./staff-calendar-provider-google.js";
import { configuredStaffCalendarProvider, configuredStaffCalendarProviderForBooking } from "./staff-calendar-provider.js";

const context = () => ({ env: {
  STAFF_APPOINTMENT_GOOGLE_CALENDAR_ID: "garrett-appointments@group.calendar.google.com",
  STAFF_APPOINTMENT_GOOGLE_USER: "Garrett",
  PORTAL_KV: { get: vi.fn(async (key) => key === "google:garrett:grant_status" ? JSON.stringify({
    actor: "Garrett",
    primaryCalendarId: "garrett@amarimethod.com",
    scopes: ["https://www.googleapis.com/auth/calendar"],
    writableCalendarIds: ["garrett-appointments@group.calendar.google.com"],
    bookingActivationEnabled: false,
  }) : null) },
} });

function event(overrides = {}) {
  return {
    id: "google-event-1",
    status: "confirmed",
    summary: "Amari Method Partner Initial Session",
    start: { dateTime: "2026-09-01T10:00:00-07:00", timeZone: "America/Los_Angeles" },
    end: { dateTime: "2026-09-01T11:00:00-07:00", timeZone: "America/Los_Angeles" },
    extendedProperties: { private: {
      amariAuthorityVersion: "1",
      amariOwnedContactId: "owned-contact-1",
      amariServiceId: "partner-initial",
      amariServiceCalendarId: "lfsnaiGiLNL2z12pLKDP",
    } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllGlobals());

describe("owned Google Staff calendar adapter", () => {
  it("is never selected implicitly and fails closed without exact configuration", () => {
    expect(configuredStaffCalendarProvider({})).toBe("ghl");
    expect(configuredStaffCalendarProvider({ STAFF_APPOINTMENT_CALENDAR_PROVIDER: "google_calendar" }))
      .toBe("google_calendar");
    expect(configuredStaffCalendarProviderForBooking(
      { STAFF_APPOINTMENT_CALENDAR_PROVIDER: "google_calendar" }, { serviceId: "partner-initial" },
    )).toBe("google_calendar");
    expect(configuredStaffCalendarProviderForBooking(
      { STAFF_APPOINTMENT_CALENDAR_PROVIDER: "google_calendar" }, { serviceId: "partner-initial-virtual" },
    )).toBe("ghl");
    expect(() => createGoogleStaffCalendarProvider({ env: {} }, "owned-contact-1"))
      .toThrow(/not configured/);
  });

  it("creates and exactly reads back an owned event without attendees or Google notifications", async () => {
    const fetch = vi.fn(async (_url, init = {}) => {
      if (init.method === "POST") return new Response(JSON.stringify(event()), { status: 200 });
      return new Response(JSON.stringify(event()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const onCreated = vi.fn(async () => {});
    const provider = createGoogleStaffCalendarProvider(context(), "owned-contact-1");

    const created = await provider.createAppointment({
      booking: {
        serviceId: "partner-initial",
        calendarId: "lfsnaiGiLNL2z12pLKDP",
        durationMinutes: 60,
        title: "Amari Method Partner Initial Session",
      },
      startTime: "2026-09-01T10:00:00-07:00",
      timezone: "America/Los_Angeles",
      onCreated,
    });

    expect(created).toMatchObject({
      id: "google-event-1", contactId: "owned-contact-1", serviceId: "partner-initial",
      calendarId: "lfsnaiGiLNL2z12pLKDP", providerCalendarId: "garrett-appointments@group.calendar.google.com",
      appointmentStatus: "confirmed",
    });
    expect(onCreated).toHaveBeenCalledWith("google-event-1", {
      provider: "google_calendar", providerCalendarId: "garrett-appointments@group.calendar.google.com",
    });
    const [url, init] = fetch.mock.calls.find(([, options]) => options?.method === "POST");
    expect(String(url)).toContain("sendUpdates=none");
    expect(String(url)).toContain("conferenceDataVersion=0");
    expect(String(url)).not.toContain("leadconnectorhq");
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("attendees");
    expect(body.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(body.extendedProperties.private).toEqual({
      amariAuthorityVersion: "1",
      amariOwnedContactId: "owned-contact-1",
      amariServiceId: "partner-initial",
      amariServiceCalendarId: "lfsnaiGiLNL2z12pLKDP",
    });
  });

  it("refuses every provider request without the governed identity marker", async () => {
    const ctx = context();
    ctx.env.PORTAL_KV.get.mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = createGoogleStaffCalendarProvider(ctx, "owned-contact-1");
    await expect(provider.listSchedule("2026-09-01T00:00:00-07:00", "2026-09-02T00:00:00-07:00"))
      .rejects.toMatchObject({ code: "calendar_provider_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getGoogleToken).not.toHaveBeenCalled();
  });

  it("pins contact queries to private owned identity and treats provider deletion as cancelled readback", async () => {
    const fetch = vi.fn(async (url, init = {}) => {
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (String(url).includes("/google-event-1") && !String(url).includes("?")) {
        return new Response(null, { status: 410 });
      }
      return new Response(JSON.stringify({ items: [event()] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const provider = createGoogleStaffCalendarProvider(context(), "owned-contact-1");

    await expect(provider.listContactAppointments()).resolves.toHaveLength(1);
    const listUrl = String(fetch.mock.calls[0][0]);
    expect(decodeURIComponent(listUrl)).toContain("privateExtendedProperty=amariOwnedContactId=owned-contact-1");
    await provider.cancelAppointment({ id: "google-event-1" });
    expect(fetch.mock.calls.some(([url, init]) => init?.method === "DELETE" && String(url).includes("sendUpdates=none"))).toBe(true);
    await expect(provider.getAppointment("google-event-1", "owned-contact-1", event()))
      .resolves.toMatchObject({ id: "google-event-1", status: "cancelled", appointmentStatus: "cancelled" });
  });

  it("compensates a created event when exact owned readback does not match intent", async () => {
    const fetch = vi.fn(async (_url, init = {}) => {
      if (init.method === "POST") return new Response(JSON.stringify(event()), { status: 200 });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify(event({
        extendedProperties: { private: {
          ...event().extendedProperties.private,
          amariOwnedContactId: "another-owned-contact",
        } },
      })), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const provider = createGoogleStaffCalendarProvider(context(), "owned-contact-1");

    await expect(provider.createAppointment({
      booking: {
        serviceId: "partner-initial",
        calendarId: "lfsnaiGiLNL2z12pLKDP",
        durationMinutes: 60,
        title: "Amari Method Partner Initial Session",
      },
      startTime: "2026-09-01T10:00:00-07:00",
      timezone: "America/Los_Angeles",
      onCreated: vi.fn(async () => {}),
    })).rejects.toMatchObject({
      code: "provider_readback_mismatch",
      phase: "readback",
      appointmentId: "google-event-1",
      cleanupStatus: 204,
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
});
