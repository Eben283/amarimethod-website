import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COPY,
  computeMorningTimes,
  dateKeyInZone,
  dueKinds,
  messageForKind,
  zonedTimeToUtcMs,
} from "./schedule.js";

describe("dateKeyInZone", () => {
  it("returns Pacific calendar date", () => {
    // 2026-07-30 15:00 UTC = 08:00 PDT
    assert.equal(dateKeyInZone(Date.parse("2026-07-30T15:00:00Z")), "2026-07-30");
  });
});

describe("zonedTimeToUtcMs", () => {
  it("maps 08:00 PDT to 15:00 UTC", () => {
    assert.equal(zonedTimeToUtcMs("2026-07-30", 8 * 60), Date.parse("2026-07-30T15:00:00Z"));
  });

  it("maps 08:00 PST to 16:00 UTC", () => {
    assert.equal(zonedTimeToUtcMs("2026-01-15", 8 * 60), Date.parse("2026-01-15T16:00:00Z"));
  });
});

describe("computeMorningTimes", () => {
  it("defaults to 08:00 / 09:30 when no appointment", () => {
    const nowMs = Date.parse("2026-07-30T14:00:00Z");
    const s = computeMorningTimes({ nowMs });
    assert.equal(s.dateKey, "2026-07-30");
    assert.equal(s.firstAtMs, Date.parse("2026-07-30T15:00:00Z"));
    assert.equal(s.secondAtMs, Date.parse("2026-07-30T16:30:00Z"));
    assert.equal(s.reason, "default-08:00");
  });

  it("pulls earlier when first appt is before 10:00 PT", () => {
    const nowMs = Date.parse("2026-07-30T10:00:00Z");
    const firstAppt = Date.parse("2026-07-30T15:00:00Z"); // 08:00 PT
    const s = computeMorningTimes({ nowMs, firstAppointmentMs: firstAppt });
    assert.equal(s.firstAtMs, Date.parse("2026-07-30T13:00:00Z")); // 06:00 PT
    assert.equal(s.secondAtMs, Date.parse("2026-07-30T14:30:00Z")); // 07:30 PT
    assert.equal(s.reason, "two-hours-before-first-appt");
  });

  it("keeps 08:00 when first appt is later in the day", () => {
    const nowMs = Date.parse("2026-07-30T14:00:00Z");
    const firstAppt = Date.parse("2026-07-30T20:00:00Z"); // 13:00 PT
    const s = computeMorningTimes({ nowMs, firstAppointmentMs: firstAppt });
    assert.equal(s.firstAtMs, Date.parse("2026-07-30T15:00:00Z"));
    assert.equal(s.reason, "default-08:00-appt-later");
  });
});

describe("dueKinds", () => {
  it("fires prepare inside grace window", () => {
    const first = Date.parse("2026-07-30T15:00:00Z");
    const second = Date.parse("2026-07-30T16:30:00Z");
    assert.deepEqual(dueKinds(first + 60_000, first, second), ["prepare"]);
    assert.deepEqual(dueKinds(second + 60_000, first, second), ["meeting"]);
    assert.deepEqual(dueKinds(first - 60_000, first, second), []);
  });
});

describe("copy", () => {
  it("matches requested wording", () => {
    assert.equal(messageForKind("prepare"), COPY.prepare);
    assert.equal(messageForKind("meeting"), COPY.meeting);
    assert.equal(COPY.prepare, "Good morning, time to prepare for the day.");
    assert.equal(COPY.meeting, "Staff meeting");
  });
});
