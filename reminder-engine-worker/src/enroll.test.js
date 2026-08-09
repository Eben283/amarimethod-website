import { describe, it, expect } from "vitest";
import { INITIAL_IN_PERSON } from "./config.js";
import { enroll, isEligible, resolveDueAt } from "./enroll.js";

const START = Date.parse("2026-07-20T15:00:00-07:00");
const NOW_2D_BEFORE = Date.parse("2026-07-18T15:00:00-07:00"); // exactly 2 days before start
const MIN = 60000;

const evt = (over = {}) => ({
  type: "confirmed",
  recognized: true,
  status: "confirmed",
  calendarId: "G7OAnnJuFbMF6nQSlZVQ",
  contactId: "cont_1",
  appointmentId: "appt_1",
  startAt: "2026-07-20T15:00:00-07:00",
  modifiedBy: "customer",
  ...over,
});

describe("resolveDueAt", () => {
  it("resolves enroll to now, and start±Nm relative to start", () => {
    expect(resolveDueAt("enroll", START, NOW_2D_BEFORE)).toBe(NOW_2D_BEFORE);
    expect(resolveDueAt("enroll+1440m", START, NOW_2D_BEFORE)).toBe(NOW_2D_BEFORE + 1440 * MIN);
    expect(resolveDueAt("start-1440m", START, NOW_2D_BEFORE)).toBe(START - 1440 * MIN);
    expect(resolveDueAt("start-60m", START, NOW_2D_BEFORE)).toBe(START - 60 * MIN);
    expect(resolveDueAt("start+5m", START, NOW_2D_BEFORE)).toBe(START + 5 * MIN);
  });
  it("throws on a malformed offset", () => {
    expect(() => resolveDueAt("start~5m", START, NOW_2D_BEFORE)).toThrow();
  });
});

describe("isEligible", () => {
  it("accepts a configured-calendar event whose status is in enrollOn", () => {
    expect(isEligible(evt(), INITIAL_IN_PERSON)).toBe(true);
    expect(isEligible(evt({ type: "booked" }), INITIAL_IN_PERSON)).toBe(false);
    expect(isEligible(evt({ calendarId: "EM6vB2mq7EAdGCbUb3j1" }), INITIAL_IN_PERSON)).toBe(true);
  });
  it("rejects a different calendar", () => {
    expect(isEligible(evt({ calendarId: "other" }), INITIAL_IN_PERSON)).toBe(false);
  });
  it("rejects a status not in enrollOn", () => {
    expect(isEligible(evt({ type: "showed" }), INITIAL_IN_PERSON)).toBe(false);
    expect(isEligible(evt({ type: "cancelled" }), INITIAL_IN_PERSON)).toBe(false);
  });
  it("honors a modifiedBy filter when the flow sets one", () => {
    const userOnly = { ...INITIAL_IN_PERSON, enrollOn: { statuses: ["confirmed"], modifiedBy: ["user"] } };
    expect(isEligible(evt({ modifiedBy: "customer" }), userOnly)).toBe(false);
    expect(isEligible(evt({ modifiedBy: "user" }), userOnly)).toBe(true);
  });

  it("accepts the Assessment trigger without an actor but retains the legacy calendar actor gate", () => {
    expect(isEligible(evt({ calendarId: "EM6vB2mq7EAdGCbUb3j1", modifiedBy: null }), INITIAL_IN_PERSON)).toBe(true);
    expect(isEligible(evt({ calendarId: "G7OAnnJuFbMF6nQSlZVQ", modifiedBy: null }), INITIAL_IN_PERSON)).toBe(false);
  });
  it("rejects an unrecognized event", () => {
    expect(isEligible(evt({ recognized: false }), INITIAL_IN_PERSON)).toBe(false);
  });
});

describe("enroll", () => {
  it("builds an active enrollment with the six current live message actions", () => {
    const e = enroll(evt(), INITIAL_IN_PERSON, NOW_2D_BEFORE);
    expect(e).toMatchObject({
      flowKey: "initial-in-person",
      appointmentId: "appt_1",
      contactId: "cont_1",
      calendarId: "G7OAnnJuFbMF6nQSlZVQ",
      status: "active",
      enrolledAt: NOW_2D_BEFORE,
    });
    expect(e.steps).toHaveLength(6);
    expect(e.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("computes each step's dueAt from its offset", () => {
    const e = enroll(evt(), INITIAL_IN_PERSON, NOW_2D_BEFORE);
    expect(e.steps[0].dueAt).toBe(NOW_2D_BEFORE); // enroll
    expect(e.steps[1].dueAt).toBe(NOW_2D_BEFORE); // enroll
    expect(e.steps[2].dueAt).toBe(START - 1440 * MIN); // day-before
    expect(e.steps[3].dueAt).toBe(START - 60 * MIN); // 1-hour sms
  });

  it("marks nothing skipped when enrolled well before the appointment", () => {
    const e = enroll(evt(), INITIAL_IN_PERSON, NOW_2D_BEFORE);
    expect(e.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("skips only skipIfPast steps whose time already passed (same-hour booking)", () => {
    const nowLate = START - 30 * MIN; // booked 30 min before start
    const e = enroll(evt(), INITIAL_IN_PERSON, nowLate);
    // enroll steps still pending (dueAt = now)
    expect(e.steps[0].status).toBe("pending");
    expect(e.steps[1].status).toBe("pending");
    // day-before + all three start-60m steps are past AND skipIfPast → skipped
    expect(e.steps[2].status).toBe("skipped");
    expect(e.steps[3].status).toBe("skipped");
    expect(e.steps[4].status).toBe("skipped");
    expect(e.steps[5].status).toBe("skipped");
  });

  it("returns null for an ineligible event", () => {
    expect(enroll(evt({ calendarId: "other" }), INITIAL_IN_PERSON, NOW_2D_BEFORE)).toBe(null);
    expect(enroll(evt({ type: "showed" }), INITIAL_IN_PERSON, NOW_2D_BEFORE)).toBe(null);
  });

  it("returns null when startAt is unparseable (can't schedule)", () => {
    expect(enroll(evt({ startAt: "not-a-date" }), INITIAL_IN_PERSON, NOW_2D_BEFORE)).toBe(null);
  });

  it("does not mutate a frozen event or flow", () => {
    const frozen = Object.freeze(evt());
    expect(() => enroll(frozen, INITIAL_IN_PERSON, NOW_2D_BEFORE)).not.toThrow();
  });
});
