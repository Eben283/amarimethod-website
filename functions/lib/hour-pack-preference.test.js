import { describe, it, expect } from "vitest";
import {
  smashesNextOnHour,
  applyHourPackPreference,
  blockMinutes,
  SLOT_POLICIES,
} from "./booking-slot-policy.js";

describe("smashesNextOnHour", () => {
  it("flags a 10:40 start with block 60 as smashing 11:00", () => {
    expect(smashesNextOnHour(10, 40, 60)).toBe(true);
  });

  it("keeps a 10:00 start with block 60 as preserving 11:00", () => {
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
  const discoveryId = "USgPsktqRcuomdUgpShL";

  it("filters Follow-up and Assessment to on-the-hour starts only", () => {
    expect(blockMinutes(SLOT_POLICIES.assessment)).toBe(70);
    const slots = [
      { date: "2026-08-05", time: "10:00", hour: 10, minute: 0, datetime: "2026-08-05T10:00:00-07:00" },
      { date: "2026-08-05", time: "10:40", hour: 10, minute: 40, datetime: "2026-08-05T10:40:00-07:00" },
      { date: "2026-08-05", time: "11:00", hour: 11, minute: 0, datetime: "2026-08-05T11:00:00-07:00" },
    ];
    expect(applyHourPackPreference(slots, { calendarId: followupId }).map((s) => s.time)).toEqual([
      "10:00",
      "11:00",
    ]);
    expect(applyHourPackPreference(slots, { calendarId: assessmentId }).map((s) => s.time)).toEqual([
      "10:00",
      "11:00",
    ]);
  });

  it("for Discovery, prefers slots that leave the next hour free", () => {
    const slots = [
      { date: "2026-08-05", time: "10:00", hour: 10, minute: 0, datetime: "2026-08-05T10:00:00-07:00" },
      { date: "2026-08-05", time: "10:45", hour: 10, minute: 45, datetime: "2026-08-05T10:45:00-07:00" },
      { date: "2026-08-05", time: "11:00", hour: 11, minute: 0, datetime: "2026-08-05T11:00:00-07:00" },
    ];
    const out = applyHourPackPreference(slots, { calendarId: discoveryId });
    expect(out.map((s) => s.time)).toEqual(["10:00", "11:00"]);
  });

  it("does not empty a Discovery day that only has smashing slots", () => {
    const slots = [
      { date: "2026-08-05", time: "10:45", hour: 10, minute: 45, datetime: "2026-08-05T10:45:00-07:00" },
    ];
    const out = applyHourPackPreference(slots, { calendarId: discoveryId });
    expect(out.map((s) => s.time)).toEqual(["10:45"]);
  });
});
