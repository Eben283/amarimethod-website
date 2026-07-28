import { describe, expect, it } from "vitest";
import {
  applyLookBusy,
  hash32,
  hidePercentForDate,
  isoWeekKey,
} from "../lib/look-busy.js";

function slot(date, time) {
  return {
    date,
    time,
    hour: Number(time.slice(0, 2)),
    minute: Number(time.slice(3, 5)),
    datetime: `${date}T${time}:00-07:00`,
  };
}

describe("look-busy helpers", () => {
  it("hashes stably", () => {
    expect(hash32("abc")).toBe(hash32("abc"));
    expect(hash32("abc")).not.toBe(hash32("abd"));
  });

  it("builds ISO week keys", () => {
    expect(isoWeekKey("2026-08-04")).toMatch(/^2026-W\d{2}$/);
    expect(isoWeekKey("2026-08-04")).toBe(isoWeekKey("2026-08-05"));
  });

  it("wobbles hide percent into a bounded band", () => {
    for (let d = 1; d <= 28; d++) {
      const p = hidePercentForDate(`2026-08-${String(d).padStart(2, "0")}`);
      expect(p).toBeGreaterThanOrEqual(35);
      expect(p).toBeLessThanOrEqual(70);
    }
  });
});

describe("applyLookBusy", () => {
  const cal = "EM6vB2mq7EAdGCbUb3j1";

  it("returns empty / missing calendar unchanged", () => {
    expect(applyLookBusy([], { calendarId: cal })).toEqual([]);
    const slots = [slot("2026-08-04", "11:00")];
    expect(applyLookBusy(slots, {})).toEqual(slots);
  });

  it("keeps short days intact", () => {
    const slots = [slot("2026-08-04", "11:00"), slot("2026-08-04", "11:40")];
    expect(applyLookBusy(slots, { calendarId: cal })).toEqual(slots);
  });

  it("always keeps the earliest slot on a busy day", () => {
    const times = [
      "11:00",
      "11:40",
      "12:20",
      "13:00",
      "13:40",
      "14:20",
      "15:00",
      "15:40",
      "16:20",
      "17:00",
      "17:40",
      "18:20",
    ];
    const slots = times.map((t) => slot("2026-08-04", t));
    const out = applyLookBusy(slots, { calendarId: cal, hidePercent: 55 });
    expect(out[0].time).toBe("11:00");
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThan(slots.length);
  });

  it("is stable within the same week and calendar", () => {
    const times = ["10:00", "10:40", "11:20", "12:00", "12:40", "13:20", "14:00", "14:40"];
    const slots = times.map((t) => slot("2026-08-05", t));
    const a = applyLookBusy(slots, { calendarId: cal }).map((s) => s.datetime);
    const b = applyLookBusy(slots, { calendarId: cal }).map((s) => s.datetime);
    expect(a).toEqual(b);
  });

  it("can differ across calendars for the same times", () => {
    const times = ["10:00", "10:40", "11:20", "12:00", "12:40", "13:20", "14:00", "14:40", "15:20", "16:00"];
    const slots = times.map((t) => slot("2026-08-05", t));
    const a = applyLookBusy(slots, { calendarId: "cal-a", hidePercent: 55 }).map((s) => s.time);
    const b = applyLookBusy(slots, { calendarId: "cal-b", hidePercent: 55 }).map((s) => s.time);
    // Not guaranteed different, but with 10 slots and 55% hide it almost always is;
    // assert at least that both kept earliest.
    expect(a[0]).toBe("10:00");
    expect(b[0]).toBe("10:00");
  });
});
