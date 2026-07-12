import { describe, it, expect } from "vitest";
import { SEQUENCES, FLOW_1_QUIZ, FLOW_2_POST_DISCOVERY, FLOW_3_POST_INITIAL } from "./config.js";
import { eventMatches } from "./events.js";

// The configs ARE the ported workflows (8 GHL workflows → 3 config objects). These tests pin
// the brief's non-negotiables: shadow default, the exit fan-in, and the 2026-03-05
// ambassador-calendar fix that must not be lost (acquisition-nurture.md).

describe("registry", () => {
  it("exposes the three flows, all in shadow mode (never sends by default)", () => {
    expect(SEQUENCES.map((s) => s.sequenceId)).toEqual([
      "flow-1-quiz", "flow-2-post-discovery", "flow-3-post-initial",
    ]);
    for (const s of SEQUENCES) expect(s.mode).toBe("shadow");
  });

  it("configs are frozen (immutable by construction)", () => {
    expect(Object.isFrozen(FLOW_1_QUIZ)).toBe(true);
    expect(Object.isFrozen(FLOW_1_QUIZ.steps)).toBe(true);
    expect(Object.isFrozen(FLOW_3_POST_INITIAL.exits)).toBe(true);
  });
});

describe("Flow 1 — quiz nurture", () => {
  it("enters on quiz.submitted with no guard", () => {
    expect(eventMatches(FLOW_1_QUIZ.entry.on, { kind: "quiz.submitted", contactId: "c1" })).toBe(true);
    expect(FLOW_1_QUIZ.entry.guard).toBeUndefined();
  });

  it("a booking on the AMBASSADOR discovery calendar also exits (the 2026-03-05 fix)", () => {
    const booked = {
      kind: "appointment", type: "booked", calendarId: "aVE54Qf4lrbYTB0zFqXy",
      contactId: "c1", appointmentId: "a1", modifiedBy: "customer",
    };
    expect(FLOW_1_QUIZ.exits.some((x) => eventMatches(x, booked))).toBe(true);
  });

  it("a confirmed discovery appointment exits regardless of actor (GHL auto-confirms — the booking moment reads as confirmed)", () => {
    const confirmed = (modifiedBy) => ({
      kind: "appointment", type: "confirmed", calendarId: "USgPsktqRcuomdUgpShL",
      contactId: "c1", appointmentId: "a1", modifiedBy,
    });
    expect(FLOW_1_QUIZ.exits.some((x) => eventMatches(x, confirmed("user")))).toBe(true);
    expect(FLOW_1_QUIZ.exits.some((x) => eventMatches(x, confirmed("customer")))).toBe(true);
    expect(FLOW_1_QUIZ.exits.some((x) => eventMatches(x, confirmed(null)))).toBe(true);
  });

  it("both funnel-advance tags exit (replacing two deleted remove-from workflows)", () => {
    for (const tag of ["booked discovery call - workflow 2", "workflow 3 (customer attended 1st session)"]) {
      expect(FLOW_1_QUIZ.exits.some((x) => eventMatches(x, { kind: "tag.added", contactId: "c1", tag }))).toBe(true);
    }
  });

  it("has the 6-email step sequence with the two pain-location branches", () => {
    expect(FLOW_1_QUIZ.steps).toHaveLength(6);
    expect(FLOW_1_QUIZ.steps[1].kind).toBe("branch");
    expect(FLOW_1_QUIZ.steps[3].kind).toBe("branch_map");
  });
});

describe("Flow 2 — post-discovery", () => {
  it("enters on showed on the discovery calendar, guarded against ambassador-prospect", () => {
    const showed = {
      kind: "appointment", type: "showed", calendarId: "USgPsktqRcuomdUgpShL",
      contactId: "c1", appointmentId: "a1", modifiedBy: null,
    };
    expect(eventMatches(FLOW_2_POST_DISCOVERY.entry.on, showed)).toBe(true);
    expect(FLOW_2_POST_DISCOVERY.entry.guard).toEqual({ notTags: ["ambassador-prospect"] });
    expect(FLOW_2_POST_DISCOVERY.entry.onEnter).toEqual({ addTags: ["discovery call attended"] });
  });

  it("exits on an initial-session booking on either calendar", () => {
    for (const calendarId of ["G7OAnnJuFbMF6nQSlZVQ", "ySmht5hx4uZGEpgZrlCw"]) {
      const booked = { kind: "appointment", type: "booked", calendarId, contactId: "c1", appointmentId: "a1", modifiedBy: "customer" };
      expect(FLOW_2_POST_DISCOVERY.exits.some((x) => eventMatches(x, booked))).toBe(true);
    }
  });
});

describe("Flow 3 — post-initial", () => {
  it("enters on showed on either initial calendar, guarded against affiliate-partner, and writes the workflow-3 tag", () => {
    for (const calendarId of ["G7OAnnJuFbMF6nQSlZVQ", "ySmht5hx4uZGEpgZrlCw"]) {
      const showed = { kind: "appointment", type: "showed", calendarId, contactId: "c1", appointmentId: "a1", modifiedBy: null };
      expect(eventMatches(FLOW_3_POST_INITIAL.entry.on, showed)).toBe(true);
    }
    expect(FLOW_3_POST_INITIAL.entry.guard).toEqual({ notTags: ["affiliate-partner"] });
    expect(FLOW_3_POST_INITIAL.entry.onEnter).toEqual({ addTags: ["workflow 3 (customer attended 1st session)"] });
  });

  it("exits on any of the 4 series/upgrade products (the deleted remove-from workflow's purchase fan-in)", () => {
    for (const productId of [
      "69986faa724ecd2343ebaa6e", "69987357c839790426996114",
      "6998739230cc6054f9bba62d", "699873d6990b71ebc1fa26b4",
    ]) {
      expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, { kind: "purchase", contactId: "c1", productId }))).toBe(true);
    }
  });

  it("exits on a booking on any of the 5 follow-up/entrainment calendars, and NOT on others", () => {
    const booked = (calendarId) => ({ kind: "appointment", type: "booked", calendarId, contactId: "c1", appointmentId: "a1", modifiedBy: "customer" });
    for (const cal of [
      "ZO1jlGfy01rsxVqicoSB", "bJFkhVP35Ecwh4tLnSmy", "SKDVOL8wtUN6Ne0ppbC9",
      "oVn77FcecFY16iS2pHyP", "B5aGXLoS4kzAjZAMMXxk",
    ]) {
      expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, booked(cal)))).toBe(true);
    }
    // RED test (c) from the brief: a non-listed calendar does NOT exit
    expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, booked("USgPsktqRcuomdUgpShL")))).toBe(false);
  });
});
