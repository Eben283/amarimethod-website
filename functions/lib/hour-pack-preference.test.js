import { describe, it, expect } from "vitest";
import {
  smashesNextOnHour,
  slotPreservesNextOnHour,
  applyHourPackPreference,
  blockMinutes,
  SLOT_POLICIES,
} from "./booking-slot-policy.js";

describe("smashesNextOnHour", () => {
  it("flags Assessment 10:40 / block 50 as smashing 11:00", () => {
    expect(smashesNextOnHour(10, 40, 50)).toBe(true);
  });

  it("keeps Assessment 10:00 / block 50 as preserving 11:00", () => {
    expect(smashesNextOnHour(10, 0, 50)).toBe(false);
  });

  it("treats block ending exactly on the next hour as preserving", () => {
    // 10:00 + 60 → free at 11:00
    expect(smashesNextOnHour(10, 0, 60)).toBe(false);
  });

  it("flags Discovery 10:45 / block 30 as smashing 11:00", () => {
    expect(smashesNextOnHour(10, 45, 30)).toBe(true);
    expect(smashesNextOnHour(10, 15, 30)).toBe(false);
  });
});

describe("applyHourPackPreference", () => {
  const assessmentId = "EM6vB2mq7EAdGCbUb3j1";
  const followupId = "SKDVOL8wtUN6Ne0ppbC9";

  it("filters Follow-up to on-the-hour starts only", () => {
    const slots = [
      { date: "2026-08-05", time: "10:00", hour: 10, minute: 0, datetime: "2026-08-05T10:00:00-07:00" },
      { date: "2026-08-05", time: "10:30", hour: 10, minute: 30, datetime: "2026-08-05T10:30:00-07:00" },
      { date: "2026-08-05", time: "11:00", hour: 11, minute: 0, datetime: "2026-08-05T11:00:00-07:00" },
    ];
    const out = applyHourPackPreference(slots, { calendarId: followupId });
    expect(out.map((s) => s.time)).toEqual(["10:00", "11:00"]);
  });

  it("prefers Assessment slots that leave the next hour free", () => {
    expect(blockMinutes(SLOT_POLICIES.assessment)).toBe(50);
    const slots = [
      { date: "2026-08-05", time: "10:00", hour: 10, minute: 0, datetime: "2026-08-05T10:00:00-07:00" },
      { date: "2026-08-05", time: "10:40", hour: 10, minute: 40, datetime: "2026-08-05T10:40:00-07:00" },
      { date: "2026-08-05", time: "11:20", hour: 11, minute: 20, datetime: "2026-08-05T11:20:00-07:00" },
      { date: "2026-08-05", time: "12:00", hour: 12, minute: 0, datetime: "2026-08-05T12:00:00-07:00" },
    ];
    const out = applyHourPackPreference(slots, { calendarId: assessmentId });
    expect(out.map((s) => s.time)).toEqual(["10:00", "12:00"]);
    expect(out.every((s) => slotPreservesNextOnHour(s, 50))).toBe(true);
  });

  it("does not empty a day that only has smashing Assessment slots", () => {
    const slots = [
      { date: "2026-08-05", time: "10:40", hour: 10, minute: 40, datetime: "2026-08-05T10:40:00-07:00" },
      { date: "2026-08-05", time: "11:20", hour: 11, minute: 20, datetime: "2026-08-05T11:20:00-07:00" },
    ];
    const out = applyHourPackPreference(slots, { calendarId: assessmentId });
    expect(out.map((s) => s.time)).toEqual(["10:40", "11:20"]);
  });

  it("applies per-day so one smashed-only day does not affect another", () => {
    const slots = [
      { date: "2026-08-05", time: "10:40", hour: 10, minute: 40, datetime: "2026-08-05T10:40:00-07:00" },
      { date: "2026-08-06", time: "10:00", hour: 10, minute: 0, datetime: "2026-08-06T10:00:00-07:00" },
      { date: "2026-08-06", time: "10:40", hour: 10, minute: 40, datetime: "2026-08-06T10:40:00-07:00" },
    ];
    const out = applyHourPackPreference(slots, { calendarId: assessmentId });
    expect(out.map((s) => `${s.date} ${s.time}`)).toEqual([
      "2026-08-05 10:40",
      "2026-08-06 10:00",
    ]);
  });

  it("is a no-op for unknown calendars", () => {
    const slots = [
      { date: "2026-08-05", time: "10:40", hour: 10, minute: 40, datetime: "x" },
    ];
    expect(applyHourPackPreference(slots, { calendarId: "unknown" })).toEqual(slots);
  });
});
