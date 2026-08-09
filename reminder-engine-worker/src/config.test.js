import { describe, it, expect } from "vitest";
import { FLOWS, INITIAL_IN_PERSON, INITIAL_VIRTUAL, DISCOVERY_CALL, PARTNER_INITIAL_IN_PERSON, ASSESSMENT_NO_SHOW, flowsForCalendar } from "./config.js";

// Config snapshot tests per the cluster brief: each flow's step count, offsets, and enroll
// filters pinned against the twin specs, and the shadow default pinned for every flow.

describe("registry", () => {
  it("exposes the five configured flows, all in shadow mode", () => {
    expect(FLOWS.map((f) => f.flowKey)).toEqual(["initial-in-person", "initial-virtual", "discovery-call", "partner-initial-in-person", "assessment-no-show"]);
    for (const f of FLOWS) expect(f.mode).toBe("shadow");
  });

  it("routes calendars to their flows (discovery covers all THREE discovery calendars)", () => {
    for (const cal of ["G7OAnnJuFbMF6nQSlZVQ", "EM6vB2mq7EAdGCbUb3j1"]) {
      expect(flowsForCalendar(cal).map((f) => f.flowKey)).toEqual(cal === "EM6vB2mq7EAdGCbUb3j1" ? ["initial-in-person", "assessment-no-show"] : ["initial-in-person"]);
    }
    expect(flowsForCalendar("ySmht5hx4uZGEpgZrlCw").map((f) => f.flowKey)).toEqual(["initial-virtual"]);
    for (const cal of ["USgPsktqRcuomdUgpShL", "aVE54Qf4lrbYTB0zFqXy", "ZEIGFHBi17SpZ3Ezi5DR"]) {
      expect(flowsForCalendar(cal).map((f) => f.flowKey)).toEqual(["discovery-call"]);
    }
    expect(flowsForCalendar("lfsnaiGiLNL2z12pLKDP").map((f) => f.flowKey)).toEqual(["partner-initial-in-person"]);
    expect(flowsForCalendar("not-a-calendar")).toEqual([]);
  });
});

describe("flow shapes vs the twin specs", () => {
  it("initial in-person/Assessment: six current live message actions, with no retired equipment email", () => {
    expect(INITIAL_IN_PERSON.definitionVersion).toBe(2);
    expect(INITIAL_IN_PERSON.steps.map((s) => `${s.at}:${s.type}`)).toEqual([
      "enroll:internal_email", "enroll:email", "start-1440m:email",
      "start-60m:sms", "start-60m:email", "start-60m:internal_sms",
    ]);
    expect(INITIAL_IN_PERSON.steps.some((step) => step.template === "equipment-list")).toBe(false);
    expect(INITIAL_IN_PERSON.enrollOn).toEqual({ statuses: ["confirmed"], modifiedBy: ["user", "customer"] });
  });

  it("initial-virtual: 6 steps — welcome, day-before, three one-hour touches", () => {
    expect(INITIAL_VIRTUAL.steps.map((s) => `${s.at}:${s.type}`)).toEqual([
      "enroll:internal_email", "enroll:email", "start-1440m:email",
      "start-60m:email", "start-60m:sms", "start-60m:internal_sms",
    ]);
    expect(INITIAL_VIRTUAL.definitionVersion).toBe(2);
    expect(INITIAL_VIRTUAL.enrollOn).toEqual({ statuses: ["confirmed"], modifiedBy: ["user", "customer"] });
    expect(INITIAL_VIRTUAL.cancelOn).toEqual(["cancelled"]);
  });

  it("discovery-call: 7 steps including the 15-minute pair the twin documents", () => {
    expect(DISCOVERY_CALL.steps.map((s) => `${s.at}:${s.type}`)).toEqual([
      "enroll:internal_sms", "enroll:email", "start-1440m:email",
      "start-60m:sms", "start-60m:internal_sms", "start-15m:sms", "start-15m:internal_sms",
    ]);
    // timed steps never back-fire on short-notice bookings
    for (const s of DISCOVERY_CALL.steps.filter((x) => x.at !== "enroll")) {
      expect(s.skipIfPast).toBe(true);
    }
  });

  it("partner in-person: exactly mirrors the six message actions and is shadow-only", () => {
    expect(PARTNER_INITIAL_IN_PERSON.name).toBe("In-Person Partner Session: Confirmation & Reminder Flow");
    expect(PARTNER_INITIAL_IN_PERSON.calendarIds).toEqual(["lfsnaiGiLNL2z12pLKDP"]);
    expect(PARTNER_INITIAL_IN_PERSON.enrollOn.statuses).toEqual(["confirmed"]);
    expect(PARTNER_INITIAL_IN_PERSON.cancelOn).toEqual(["cancelled"]);
    expect(PARTNER_INITIAL_IN_PERSON.mode).toBe("shadow");
    expect(PARTNER_INITIAL_IN_PERSON.steps.map((s) => `${s.at}:${s.type}`)).toEqual([
      "enroll:internal_email", "enroll:email", "start-1440m:email",
      "start-60m:email", "start-60m:sms", "start-60m:internal_sms",
    ]);
    for (const step of PARTNER_INITIAL_IN_PERSON.steps.filter((step) => step.at !== "enroll")) {
      expect(step.skipIfPast).toBe(true);
    }
  });

  it("Assessment no-show: shadow-only recovery with a confirmed-rebooking exit", () => {
    expect(ASSESSMENT_NO_SHOW.calendarIds).toEqual(["EM6vB2mq7EAdGCbUb3j1"]);
    expect(ASSESSMENT_NO_SHOW.enrollOn).toEqual({ statuses: ["noshow"], modifiedBy: null });
    expect(ASSESSMENT_NO_SHOW.exitOn).toEqual(["confirmed"]);
    expect(ASSESSMENT_NO_SHOW.steps.map((s) => `${s.at}:${s.type}`)).toEqual([
      "enroll:sms", "enroll+1440m:email", "enroll+2880m:email",
    ]);
    expect(ASSESSMENT_NO_SHOW.mode).toBe("shadow");
  });
});
