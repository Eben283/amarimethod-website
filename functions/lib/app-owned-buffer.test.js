import { describe, expect, it, vi } from "vitest";
import { ghlFetch } from "./ghl.js";
import { APP_BUFFER_CALENDAR_IDS, applyGarrettSchedulePreference, fetchAppBufferEvents, filterSlotsByAppBuffer, slotRespectsAppBuffer } from "./app-owned-buffer.js";

vi.mock("./ghl.js", () => ({ ghlFetch: vi.fn() }));

const FOLLOWUP = "SKDVOL8wtUN6Ne0ppbC9";
const DISCOVERY = "USgPsktqRcuomdUgpShL";

describe("app-owned-buffer", () => {
  it("bounds the cross-calendar event sweep to three requests at a time", async () => {
    let active = 0;
    let maxActive = 0;
    ghlFetch.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    });

    await fetchAppBufferEvents({}, Date.parse("2026-08-04T00:00:00Z"), Date.parse("2026-08-05T00:00:00Z"));

    expect(ghlFetch).toHaveBeenCalledTimes(APP_BUFFER_CALENDAR_IDS.length);
    expect(maxActive).toBeLessThanOrEqual(3);
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

  it("keeps morning and evening clusters while withholding the middle", () => {
    const events = [
      { id: "morning", calendarId: FOLLOWUP, startTime: "2026-08-04T10:00:00-07:00", endTime: "2026-08-04T10:50:00-07:00", appointmentStatus: "confirmed" },
      { id: "evening", calendarId: FOLLOWUP, startTime: "2026-08-04T17:00:00-07:00", endTime: "2026-08-04T17:50:00-07:00", appointmentStatus: "confirmed" },
    ];
    const slots = [8, 10, 12, 14, 16, 18].map((hour) => ({ date: "2026-08-04", datetime: `2026-08-04T${String(hour).padStart(2, "0")}:00:00-07:00` }));
    expect(applyGarrettSchedulePreference(slots, events).map((slot) => slot.datetime.slice(11, 16))).toEqual(["08:00", "10:00", "12:00", "16:00", "18:00"]);
  });
});
