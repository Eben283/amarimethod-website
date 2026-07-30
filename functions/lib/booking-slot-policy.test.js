import { describe, it, expect } from "vitest";
import {
  SLOT_POLICIES,
  STUDIO_INTERVAL_MINUTES,
  INTRO_ASSESSMENT_INTERVAL_MINUTES,
  WORK_HOURS,
  studioSessionStarts,
  blockMinutes,
  startLattice,
  isHourlyLattice,
  policyForCalendarId,
  preferOnHourForCalendar,
  driftAgainstPolicy,
  followupPolicy,
} from "./booking-slot-policy.js";

describe("booking-slot-policy — Follow-up on-the-hour priority", () => {
  it("makes Follow-up the priority studio policy with 50/10/60", () => {
    const fu = followupPolicy();
    expect(fu.priority).toBe(true);
    expect(fu.preferOnHour).toBe(true);
    expect(fu.durationMinutes).toBe(50);
    expect(fu.bufferMinutes).toBe(10);
    expect(fu.intervalMinutes).toBe(60);
    expect(blockMinutes(fu)).toBe(60);
    expect(isHourlyLattice(fu.intervalMinutes)).toBe(true);
  });

  it("gives Follow-up only on-the-hour starts from a 10:00 open", () => {
    const grid = startLattice(10, 0, followupPolicy().intervalMinutes, 9);
    expect(grid).toEqual([
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
    ]);
    expect(grid.every((t) => t.endsWith(":00"))).toBe(true);
    expect(grid).not.toContain("10:30");
  });

  it("locks Work Hours so main sessions run 10am–6pm starts", () => {
    expect(WORK_HOURS.firstSessionStart).toBe("10:00");
    expect(WORK_HOURS.lastSessionStart).toBe("18:00");
    expect(WORK_HOURS.openFrom).toBe("10:00");
    expect(WORK_HOURS.openTo).toBe("19:00");
    const starts = studioSessionStarts();
    expect(starts[0]).toBe("10:00");
    expect(starts[starts.length - 1]).toBe("18:00");
    expect(starts).not.toContain("19:00");
  });

  it("keeps Initial on the hour but Assessment denser for intro fills", () => {
    expect(SLOT_POLICIES.initial.intervalMinutes).toBe(STUDIO_INTERVAL_MINUTES);
    expect(SLOT_POLICIES.initial.preferOnHour).toBe(true);
    expect(SLOT_POLICIES.assessment.intervalMinutes).toBe(
      INTRO_ASSESSMENT_INTERVAL_MINUTES,
    );
    expect(SLOT_POLICIES.assessment.lattice).toBe("intro");
    expect(SLOT_POLICIES.assessment.preferOnHour).toBe(false);
    expect(SLOT_POLICIES.assessment.bufferMinutes).toBe(10);
    expect(blockMinutes(SLOT_POLICIES.assessment)).toBe(50);
    const introGrid = startLattice(10, 0, SLOT_POLICIES.assessment.intervalMinutes, 4);
    expect(introGrid).toEqual(["10:00", "10:40", "11:20", "12:00"]);
  });

  it("keeps phone/short lattices denser than main studio", () => {
    expect(SLOT_POLICIES.discovery_call.intervalMinutes).toBe(15);
    expect(SLOT_POLICIES.discovery_call.preferOnHour).toBe(false);
    expect(SLOT_POLICIES.entrainment.intervalMinutes).toBe(15);
    expect(SLOT_POLICIES.entrainment.lattice).toBe("short");
  });

  it("marks prefer-on-hour only for main session calendars", () => {
    expect(preferOnHourForCalendar("SKDVOL8wtUN6Ne0ppbC9")).toBe(true);
    expect(preferOnHourForCalendar("G7OAnnJuFbMF6nQSlZVQ")).toBe(true);
    expect(preferOnHourForCalendar("EM6vB2mq7EAdGCbUb3j1")).toBe(false);
    expect(preferOnHourForCalendar("USgPsktqRcuomdUgpShL")).toBe(false);
  });
});

describe("booking-slot-policy — lookup and drift", () => {
  it("resolves known calendar ids", () => {
    expect(policyForCalendarId("SKDVOL8wtUN6Ne0ppbC9")?.id).toBe("followup");
    expect(policyForCalendarId("EM6vB2mq7EAdGCbUb3j1")?.id).toBe("assessment");
    expect(policyForCalendarId("G7OAnnJuFbMF6nQSlZVQ")?.id).toBe("initial");
    expect(policyForCalendarId("unknown")).toBe(null);
  });

  it("flags live Follow-up interval 30 and buffer 15 as drift", () => {
    const report = driftAgainstPolicy({
      id: "SKDVOL8wtUN6Ne0ppbC9",
      slotDuration: 50,
      slotInterval: 30,
      slotBuffer: 15,
    });
    expect(report.ok).toBe(false);
    expect(report.priority).toBe(true);
    expect(report.drifts).toEqual([
      { field: "slotInterval", live: 30, policy: 60 },
      { field: "slotBuffer", live: 15, policy: 10 },
    ]);
  });

  it("flags live Assessment buffer 15 as drift but keeps interval 40", () => {
    const report = driftAgainstPolicy({
      id: "EM6vB2mq7EAdGCbUb3j1",
      slotDuration: 40,
      slotInterval: 40,
      slotBuffer: 15,
    });
    expect(report.ok).toBe(false);
    expect(report.drifts).toEqual([
      { field: "slotBuffer", live: 15, policy: 10 },
    ]);
  });

  it("reports ok when live matches policy", () => {
    const report = driftAgainstPolicy({
      id: "SKDVOL8wtUN6Ne0ppbC9",
      slotDuration: 50,
      slotInterval: 60,
      slotBuffer: 10,
    });
    expect(report.ok).toBe(true);
    expect(report.drifts).toEqual([]);
  });
});
