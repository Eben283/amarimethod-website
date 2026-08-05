import { describe, it, expect } from "vitest";
import {
  SLOT_POLICIES,
  STUDIO_INTERVAL_MINUTES,
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

describe("booking-slot-policy — app-owned buffers", () => {
  it("makes Follow-up the priority studio policy with a 20-minute buffer", () => {
    const fu = followupPolicy();
    expect(fu.priority).toBe(true);
    expect(fu.preferOnHour).toBe(true);
    expect(fu.durationMinutes).toBe(50);
    expect(fu.bufferMinutes).toBe(20);
    expect(fu.intervalMinutes).toBe(60);
    expect(blockMinutes(fu)).toBe(70);
    expect(isHourlyLattice(fu.intervalMinutes)).toBe(true);
  });

  it("makes Assessment 50 minutes on the same hourly lattice", () => {
    const a = SLOT_POLICIES.assessment;
    expect(a.durationMinutes).toBe(50);
    expect(a.bufferMinutes).toBe(20);
    expect(a.intervalMinutes).toBe(STUDIO_INTERVAL_MINUTES);
    expect(a.preferOnHour).toBe(true);
    expect(a.lattice).toBe("studio");
    expect(blockMinutes(a)).toBe(70);
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
  });

  it("locks Work Hours so main sessions run 10am–6pm starts", () => {
    expect(WORK_HOURS.firstSessionStart).toBe("10:00");
    expect(WORK_HOURS.lastSessionStart).toBe("18:00");
    const starts = studioSessionStarts();
    expect(starts[0]).toBe("10:00");
    expect(starts[starts.length - 1]).toBe("18:00");
  });

  it("keeps Partner Initial at 60 and phone/short denser", () => {
    expect(SLOT_POLICIES.initial.durationMinutes).toBe(60);
    expect(SLOT_POLICIES.discovery_call.intervalMinutes).toBe(15);
    expect(SLOT_POLICIES.entrainment.durationMinutes).toBe(30);
  });

  it("marks prefer-on-hour for Assessment and Follow-up", () => {
    expect(preferOnHourForCalendar("SKDVOL8wtUN6Ne0ppbC9")).toBe(true);
    expect(preferOnHourForCalendar("EM6vB2mq7EAdGCbUb3j1")).toBe(true);
    expect(preferOnHourForCalendar("USgPsktqRcuomdUgpShL")).toBe(false);
  });
});

describe("booking-slot-policy — lookup and drift", () => {
  it("resolves known calendar ids", () => {
    expect(policyForCalendarId("SKDVOL8wtUN6Ne0ppbC9")?.id).toBe("followup");
    expect(policyForCalendarId("EM6vB2mq7EAdGCbUb3j1")?.id).toBe("assessment");
    expect(policyForCalendarId("unknown")).toBe(null);
  });

  it("flags native GHL buffer as drift because the app owns it", () => {
    const report = driftAgainstPolicy({
      id: "EM6vB2mq7EAdGCbUb3j1",
      slotDuration: 40,
      slotInterval: 40,
      slotBuffer: 15,
    });
    expect(report.ok).toBe(false);
    expect(report.drifts).toEqual([
      { field: "slotDuration", live: 40, policy: 50 },
      { field: "slotInterval", live: 40, policy: 60 },
      { field: "slotBuffer", live: 15, policy: 0 },
    ]);
  });

  it("reports ok when live Assessment has no native buffer", () => {
    const report = driftAgainstPolicy({
      id: "EM6vB2mq7EAdGCbUb3j1",
      slotDuration: 50,
      slotInterval: 60,
      slotBuffer: 0,
    });
    expect(report.ok).toBe(true);
  });
});
