import { describe, expect, it, vi } from "vitest";
import { ghlFetch } from "./ghl.js";
import { APP_BUFFER_CALENDAR_IDS, applyGarrettSchedulePreference, fetchAppBufferEvents, fetchGarrettScheduleEvents, filterSlotsByAppBuffer, slotRespectsAppBuffer } from "./app-owned-buffer.js";

vi.mock("./ghl.js", () => ({ ghlFetch: vi.fn() }));

const FOLLOWUP = "SKDVOL8wtUN6Ne0ppbC9";
const DISCOVERY = "USgPsktqRcuomdUgpShL";

describe("app-owned-buffer", () => {
  it("uses one practitioner-level event lookup and retains only governed calendars", async () => {
    ghlFetch.mockResolvedValue(new Response(JSON.stringify({
      events: [
        { id: "assessment", calendarId: "EM6vB2mq7EAdGCbUb3j1" },
        { id: "unrelated", calendarId: "not-an-amari-calendar" },
      ],
    }), { status: 200 }));

    const events = await fetchAppBufferEvents({}, Date.parse("2026-08-04T00:00:00Z"), Date.parse("2026-10-04T00:00:00Z"));

    expect(ghlFetch).toHaveBeenCalledTimes(1);
    expect(ghlFetch.mock.calls[0][1]).toContain("userId=P5b0oSTaVYfULDjZ6YyG");
    expect(events).toEqual([{ id: "assessment", calendarId: "EM6vB2mq7EAdGCbUb3j1" }]);
    expect(APP_BUFFER_CALENDAR_IDS).toContain("EM6vB2mq7EAdGCbUb3j1");
  });

  it("keeps every Garrett event when Staff calculates true internal availability", async () => {
    ghlFetch.mockResolvedValue(new Response(JSON.stringify({
      events: [
        { id: "assessment", calendarId: "EM6vB2mq7EAdGCbUb3j1" },
        { id: "external-busy", calendarId: "not-an-amari-calendar" },
      ],
    }), { status: 200 }));

    const events = await fetchGarrettScheduleEvents({}, Date.parse("2026-08-04T00:00:00Z"), Date.parse("2026-08-05T00:00:00Z"));
    expect(events.map((event) => event.id)).toEqual(["assessment", "external-busy"]);
  });

  it("keeps a 20-minute turnover after a 50-minute session", () => {
    const events = [{
      id: "existing",
      calendarId: FOLLOWUP,
      startTime: "2026-08-04T10:00:00-07:00",
      endTime: "2026-08-04T10:50:00-07:00",
      appointmentStatus: "confirmed",
    }];
    expect(slotRespectsAppBuffer("2026-08-04T11:00:00-07:00", FOLLOWUP, events)).toBe(false);
    expect(slotRespectsAppBuffer("2026-08-04T11:10:00-07:00", FOLLOWUP, events)).toBe(true);
  });

  it("enforces the proposed appointment's own post-buffer too", () => {
    const events = [{
      id: "next",
      calendarId: FOLLOWUP,
      startTime: "2026-08-04T11:05:00-07:00",
      endTime: "2026-08-04T11:55:00-07:00",
      appointmentStatus: "confirmed",
    }];
    expect(slotRespectsAppBuffer("2026-08-04T10:00:00-07:00", FOLLOWUP, events)).toBe(false);
  });

  it("uses a 10-minute turnover for discovery calls", () => {
    const events = [{
      id: "discovery",
      calendarId: DISCOVERY,
      startTime: "2026-08-04T10:00:00-07:00",
      endTime: "2026-08-04T10:15:00-07:00",
      appointmentStatus: "confirmed",
    }];
    const slots = [
      { datetime: "2026-08-04T10:20:00-07:00" },
      { datetime: "2026-08-04T10:25:00-07:00" },
    ];
    expect(filterSlotsByAppBuffer(slots, DISCOVERY, events)).toEqual([slots[1]]);
  });

  it("does not block cancelled appointments", () => {
    const events = [{
      id: "cancelled",
      calendarId: FOLLOWUP,
      startTime: "2026-08-04T10:00:00-07:00",
      endTime: "2026-08-04T10:50:00-07:00",
      appointmentStatus: "cancelled",
    }];
    expect(slotRespectsAppBuffer("2026-08-04T10:00:00-07:00", FOLLOWUP, events)).toBe(true);
  });

  it("prefers a booked morning and leaves one later option", () => {
    const events = [{ id: "morning", calendarId: FOLLOWUP, startTime: "2026-08-04T10:00:00-07:00", endTime: "2026-08-04T10:50:00-07:00", appointmentStatus: "confirmed" }];
    const slots = [10, 11, 12, 13, 15, 16].map((hour) => ({ date: "2026-08-04", datetime: `2026-08-04T${String(hour).padStart(2, "0")}:00:00-07:00` }));
    expect(applyGarrettSchedulePreference(slots, events).map((slot) => slot.datetime.slice(11, 16))).toEqual(["10:00", "11:00", "12:00", "13:00", "15:00"]);
  });

  it("uses a morning discovery call as a clustering anchor", () => {
    const events = [{
      id: "discovery-morning",
      calendarId: DISCOVERY,
      startTime: "2026-08-04T09:00:00-07:00",
      endTime: "2026-08-04T09:15:00-07:00",
      appointmentStatus: "confirmed",
    }];
    const slots = [9, 10, 11, 13, 15, 16].map((hour) => ({
      date: "2026-08-04",
      datetime: `2026-08-04T${String(hour).padStart(2, "0")}:00:00-07:00`,
    }));

    expect(
      applyGarrettSchedulePreference(slots, events).map((slot) => slot.datetime.slice(11, 16)),
    ).toEqual(["09:00", "10:00", "11:00", "13:00", "15:00"]);
  });

  it("keeps morning and evening clusters while withholding the middle", () => {
    const events = [
      { id: "morning", calendarId: FOLLOWUP, startTime: "2026-08-04T10:00:00-07:00", endTime: "2026-08-04T10:50:00-07:00", appointmentStatus: "confirmed" },
      { id: "evening", calendarId: FOLLOWUP, startTime: "2026-08-04T17:00:00-07:00", endTime: "2026-08-04T17:50:00-07:00", appointmentStatus: "confirmed" },
    ];
    const slots = [8, 10, 12, 14, 16, 18].map((hour) => ({ date: "2026-08-04", datetime: `2026-08-04T${String(hour).padStart(2, "0")}:00:00-07:00` }));
    expect(applyGarrettSchedulePreference(slots, events).map((slot) => slot.datetime.slice(11, 16))).toEqual(["08:00", "10:00", "12:00", "16:00", "18:00"]);
  });
});
