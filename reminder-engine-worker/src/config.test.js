import { describe, it, expect } from "vitest";
import { FLOWS, INITIAL_IN_PERSON, INITIAL_VIRTUAL, DISCOVERY_CALL, flowsForCalendar } from "./config.js";

// Config snapshot tests per the cluster brief: each flow's step count, offsets, and enroll
// filters pinned against the twin specs, and the shadow default pinned for every flow.

describe("registry", () => {
  it("exposes the three configured flows, all in shadow mode", () => {
    expect(FLOWS.map((f) => f.flowKey)).toEqual(["initial-in-person", "initial-virtual", "discovery-call"]);
    for (const f of FLOWS) expect(f.mode).toBe("shadow");
  });

  it("routes calendars to their flows (discovery covers all THREE discovery calendars)", () => {
    expect(flowsForCalendar("G7OAnnJuFbMF6nQSlZVQ").map((f) => f.flowKey)).toEqual(["initial-in-person"]);
    expect(flowsForCalendar("ySmht5hx4uZGEpgZrlCw").map((f) => f.flowKey)).toEqual(["initial-virtual"]);
    for (const cal of ["USgPsktqRcuomdUgpShL", "aVE54Qf4lrbYTB0zFqXy", "ZEIGFHBi17SpZ3Ezi5DR"]) {
      expect(flowsForCalendar(cal).map((f) => f.flowKey)).toEqual(["discovery-call"]);
    }
    expect(flowsForCalendar("not-a-calendar")).toEqual([]);
  });
});

describe("flow shapes vs the twin specs", () => {
  it("initial-in-person: 7 steps (twin steps 1-11 collapsed to sends)", () => {
    expect(INITIAL_IN_PERSON.steps).toHaveLength(7);
  });

  it("initial-virtual: 6 steps — welcome, day-before, three one-hour touches", () => {
    expect(INITIAL_VIRTUAL.steps.map((s) => `${s.at}:${s.type}`)).toEqual([
      "enroll:internal_email", "enroll:email", "start-1440m:email",
      "start-60m:email", "start-60m:sms", "start-60m:internal_sms",
    ]);
    expect(INITIAL_VIRTUAL.enrollOn.statuses).toEqual(["booked", "confirmed"]);
    expect(INITIAL_VIRTUAL.cancelOn).toEqual(["cancelled"]);
  });

  it("discovery-call: 7 steps including the 15-minute pair the twin documents", () => {
    expect(DISCOVERY_CALL.steps.map((s) => `${s.at}:${s.type}`)).toEqual([
      "enroll:internal_email", "enroll:email", "start-1440m:email",
      "start-60m:sms", "start-60m:internal_sms", "start-15m:sms", "start-15m:internal_sms",
    ]);
    // timed steps never back-fire on short-notice bookings
    for (const s of DISCOVERY_CALL.steps.filter((x) => x.at !== "enroll")) {
      expect(s.skipIfPast).toBe(true);
    }
  });
});
