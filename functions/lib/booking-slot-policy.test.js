import { describe, it, expect } from "vitest";
import {
  SLOT_POLICIES,
  STUDIO_INTERVAL_MINUTES,
  blockMinutes,
  startLattice,
  isHourlyLattice,
  policyForCalendarId,
  driftAgainstPolicy,
  followupPolicy,
} from "./booking-slot-policy.js";

describe("booking-slot-policy — Follow-up on-the-hour priority", () => {
  it("makes Follow-up the priority studio policy with 50/15/60", () => {
    const fu = followupPolicy();
    expect(fu.priority).toBe(true);
    expect(fu.durationMinutes).toBe(50);
    expect(fu.bufferMinutes).toBe(15);
    expect(fu.intervalMinutes).toBe(60);
    expect(blockMinutes(fu)).toBe(65);
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

  it("aligns Assessment and Initial to the same hourly studio lattice", () => {
    expect(SLOT_POLICIES.assessment.intervalMinutes).toBe(STUDIO_INTERVAL_MINUTES);
    expect(SLOT_POLICIES.initial.intervalMinutes).toBe(STUDIO_INTERVAL_MINUTES);
    expect(SLOT_POLICIES.assessment.durationMinutes).toBe(40);
    expect(SLOT_POLICIES.initial.durationMinutes).toBe(60);
  });

  it("keeps phone/short lattices denser than studio", () => {
    expect(SLOT_POLICIES.discovery_call.intervalMinutes).toBe(15);
    expect(SLOT_POLICIES.entrainment.intervalMinutes).toBe(15);
    expect(SLOT_POLICIES.entrainment.lattice).toBe("short");
  });
});

describe("booking-slot-policy — lookup and drift", () => {
  it("resolves known calendar ids", () => {
    expect(policyForCalendarId("SKDVOL8wtUN6Ne0ppbC9")?.id).toBe("followup");
    expect(policyForCalendarId("EM6vB2mq7EAdGCbUb3j1")?.id).toBe("assessment");
    expect(policyForCalendarId("G7OAnnJuFbMF6nQSlZVQ")?.id).toBe("initial");
    expect(policyForCalendarId("unknown")).toBe(null);
  });

  it("flags live Follow-up interval 30 as drift against hourly policy", () => {
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
    ]);
  });

  it("flags live Assessment interval 40 as drift", () => {
    const report = driftAgainstPolicy({
      id: "EM6vB2mq7EAdGCbUb3j1",
      slotDuration: 40,
      slotInterval: 40,
      slotBuffer: 15,
    });
    expect(report.ok).toBe(false);
    expect(report.drifts).toContainEqual({
      field: "slotInterval",
      live: 40,
      policy: 60,
    });
  });

  it("reports ok when live matches policy", () => {
    const report = driftAgainstPolicy({
      id: "SKDVOL8wtUN6Ne0ppbC9",
      slotDuration: 50,
      slotInterval: 60,
      slotBuffer: 15,
    });
    expect(report.ok).toBe(true);
    expect(report.drifts).toEqual([]);
  });
});
