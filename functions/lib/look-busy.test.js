import { describe, expect, it } from "vitest";
import {
  applyLookBusy,
  daysFromAsOf,
  hash32,
  hidePercentForDate,
  isPinnedSlot,
  isoWeekKey,
  keepTargetForDay,
  MAX_SLOTS_PER_DAY,
  targetFullPercent,
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

const DAY_TIMES = [
  "10:00",
  "10:40",
  "11:20",
  "12:00",
  "12:40",
  "13:20",
  "14:00",
  "14:40",
  "15:20",
  "16:00",
  "16:40",
  "17:20",
];

describe("look-busy helpers", () => {
  it("hashes stably", () => {
    expect(hash32("abc")).toBe(hash32("abc"));
    expect(hash32("abc")).not.toBe(hash32("abd"));
  });

  it("builds ISO week keys", () => {
    expect(isoWeekKey("2026-08-04")).toMatch(/^2026-W\d{2}$/);
    expect(isoWeekKey("2026-08-04")).toBe(isoWeekKey("2026-08-05"));
  });

  it("counts days from as-of", () => {
    expect(daysFromAsOf("2026-07-29", "2026-07-28")).toBe(1);
    expect(daysFromAsOf("2026-08-21", "2026-07-28")).toBe(24);
  });

  it("uses the intended fullness curve", () => {
    expect(targetFullPercent(0)).toBe(75);
    expect(targetFullPercent(5)).toBe(75);
    expect(targetFullPercent(6)).toBe(55);
    expect(targetFullPercent(14)).toBe(30);
    expect(targetFullPercent(30)).toBe(0);
  });

  it("maps 75% full on a 12-slot day to about 3 shown", () => {
    expect(keepTargetForDay(12, 75)).toBe(3);
    expect(keepTargetForDay(12, 0)).toBe(MAX_SLOTS_PER_DAY);
    expect(keepTargetForDay(20, 0)).toBe(MAX_SLOTS_PER_DAY);
  });

  it("hides more near-term than far-out", () => {
    const asOf = "2026-07-28";
    const near = hidePercentForDate("2026-07-30", undefined, asOf);
    const mid = hidePercentForDate("2026-08-08", undefined, asOf);
    const far = hidePercentForDate("2026-09-15", undefined, asOf);
    expect(near).toBeGreaterThanOrEqual(70);
    expect(near).toBeLessThanOrEqual(80);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it("recognizes pinned promised slots", () => {
    expect(isPinnedSlot(slot("2026-08-04", "11:00"))).toBe(true);
    expect(isPinnedSlot(slot("2026-08-21", "14:30"))).toBe(true);
    expect(isPinnedSlot(slot("2026-08-21", "14:00"))).toBe(false);
  });
});

describe("applyLookBusy", () => {
  const cal = "EM6vB2mq7EAdGCbUb3j1";
  const asOf = "2026-07-28";

  it("returns empty / missing calendar unchanged", () => {
    expect(applyLookBusy([], { calendarId: cal })).toEqual([]);
    const slots = [slot("2026-08-04", "11:00")];
    expect(applyLookBusy(slots, {})).toEqual(slots);
  });

  it("keeps short days intact", () => {
    const slots = [slot("2026-08-04", "11:00"), slot("2026-08-04", "11:40")];
    expect(applyLookBusy(slots, { calendarId: cal, asOfDate: asOf })).toEqual(slots);
  });

  it("keeps pinned Aug 4 11:00 and Aug 21 14:30 under heavy thinning", () => {
    const aug4 = [
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
    ].map((t) => slot("2026-08-04", t));
    const aug21 = [
      "10:00",
      "10:40",
      "11:20",
      "12:00",
      "12:40",
      "13:20",
      "14:30",
      "15:10",
      "15:50",
      "16:30",
      "17:10",
      "17:50",
    ].map((t) => slot("2026-08-21", t));

    const out4 = applyLookBusy(aug4, { calendarId: cal, hidePercent: 85, asOfDate: asOf });
    const out21 = applyLookBusy(aug21, { calendarId: cal, hidePercent: 85, asOfDate: asOf });
    expect(out4.some((s) => s.time === "11:00")).toBe(true);
    expect(out21.some((s) => s.time === "14:30")).toBe(true);
    expect(out21.some((s) => s.time === "10:00")).toBe(true);
  });

  it("shows ~3 slots in the first 5 days on a 12-slot day", () => {
    const near = applyLookBusy(
      DAY_TIMES.map((t) => slot("2026-07-30", t)),
      { calendarId: cal, asOfDate: asOf },
    );
    expect(near.length).toBeGreaterThanOrEqual(2);
    expect(near.length).toBeLessThanOrEqual(4);
  });

  it("caps far-out days at 12 even when underlying has more", () => {
    const many = [];
    for (let h = 8; h <= 18; h++) {
      for (const m of [0, 20, 40]) {
        many.push(slot("2026-09-15", `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`));
      }
    }
    expect(many.length).toBeGreaterThan(12);
    const far = applyLookBusy(many, { calendarId: cal, asOfDate: asOf });
    expect(far.length).toBeLessThanOrEqual(MAX_SLOTS_PER_DAY);
    expect(far.length).toBeGreaterThan(nearTermCount(asOf));
  });

  it("shows fewer slots near-term than far-out", () => {
    const near = applyLookBusy(
      DAY_TIMES.map((t) => slot("2026-07-30", t)),
      { calendarId: cal, asOfDate: asOf },
    );
    const far = applyLookBusy(
      DAY_TIMES.map((t) => slot("2026-09-10", t)),
      { calendarId: cal, asOfDate: asOf },
    );
    expect(near.length).toBeLessThan(far.length);
    expect(far.length).toBeGreaterThanOrEqual(9);
    expect(far.length).toBeLessThanOrEqual(12);
  });

  it("is stable within the same week and calendar", () => {
    const times = ["10:00", "10:40", "11:20", "12:00", "12:40", "13:20", "14:00", "14:40"];
    const slots = times.map((t) => slot("2026-08-05", t));
    const a = applyLookBusy(slots, { calendarId: cal, asOfDate: asOf }).map((s) => s.datetime);
    const b = applyLookBusy(slots, { calendarId: cal, asOfDate: asOf }).map((s) => s.datetime);
    expect(a).toEqual(b);
  });
});

function nearTermCount(asOf) {
  return applyLookBusy(
    DAY_TIMES.map((t) => slot("2026-07-30", t)),
    { calendarId: "EM6vB2mq7EAdGCbUb3j1", asOfDate: asOf },
  ).length;
}
