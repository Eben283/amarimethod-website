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
    expect(SEQUENCES.map((s) => s.definitionVersion)).toEqual([2, 2, 2]);
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

  it("has the 6-email step sequence: two pain-location branches plus located/chronic variants on 5 and 6", () => {
    expect(FLOW_1_QUIZ.steps).toHaveLength(6);
    expect(FLOW_1_QUIZ.steps.map((s) => s.kind)).toEqual(["email", "branch", "email", "branch_map", "branch", "branch"]);
    // extracted live 2026-07-12: composite quiz values are single map keys, waits are 2d
    expect(FLOW_1_QUIZ.steps[3].map["Ankles/Feet"]).toBe("f1-email-4c-spring-step");
    expect(FLOW_1_QUIZ.steps[3].map["Wrists/Hands"]).toBe("f1-email-4d-hand-balancer");
    expect(FLOW_1_QUIZ.steps[3].default).toBe("f1-email-4c-chronic");
    expect(FLOW_1_QUIZ.steps[4].after).toBe("+2d");
    expect(FLOW_1_QUIZ.steps[5].after).toBe("+2d");
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
  it("matches the current published two-email source and carries a new immutable definition version", () => {
    expect(FLOW_3_POST_INITIAL.definitionVersion).toBe(2);
    expect(FLOW_3_POST_INITIAL.steps).toEqual([
      { after: "0d", kind: "email", template: "f3-email-1-protocols-portal" },
      { after: "+5d", kind: "email", template: "f3-email-2-practice-going" },
    ]);
    expect(FLOW_3_POST_INITIAL.steps.some((step) => step.template === "f3-email-3-series-pitch")).toBe(false);
  });

  it("enters on showed on either initial calendar, guarded against affiliate-partner, and writes the workflow-3 tag", () => {
    for (const calendarId of ["G7OAnnJuFbMF6nQSlZVQ", "ySmht5hx4uZGEpgZrlCw"]) {
      const showed = { kind: "appointment", type: "showed", calendarId, contactId: "c1", appointmentId: "a1", modifiedBy: null };
      expect(eventMatches(FLOW_3_POST_INITIAL.entry.on, showed)).toBe(true);
    }
    expect(FLOW_3_POST_INITIAL.entry.guard).toEqual({ notTags: ["affiliate-partner"] });
    expect(FLOW_3_POST_INITIAL.entry.onEnter).toEqual({ addTags: ["workflow 3 (customer attended 1st session)"] });
  });

  it("exits on the 4 provider-source series/upgrades and both current native Practice products", () => {
    for (const productId of [
      "69986faa724ecd2343ebaa6e", "69987357c839790426996114",
      "6998739230cc6054f9bba62d", "699873d6990b71ebc1fa26b4",
      "6a683360017263178d05d1a3", "6a66cde7ef7b07f122ad46fb",
    ]) {
      expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, { kind: "purchase", contactId: "c1", productId }))).toBe(true);
    }
  });

  it("preserves booking/confirmation exits on 5 legacy calendars and confirmed-only exits on 2 current calendars", () => {
    const booked = (calendarId) => ({ kind: "appointment", type: "booked", calendarId, contactId: "c1", appointmentId: "a1", modifiedBy: "customer" });
    for (const cal of [
      "ZO1jlGfy01rsxVqicoSB", "bJFkhVP35Ecwh4tLnSmy", "SKDVOL8wtUN6Ne0ppbC9",
      "oVn77FcecFY16iS2pHyP", "B5aGXLoS4kzAjZAMMXxk",
    ]) {
      expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, booked(cal)))).toBe(true);
      expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, { ...booked(cal), type: "confirmed" }))).toBe(true);
    }
    for (const cal of ["wO5lnu7BOQOHEJ5YQU0f", "waHmG2mHNThPfMVuNJWG"]) {
      expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, booked(cal)))).toBe(false);
      expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, { ...booked(cal), type: "confirmed" }))).toBe(true);
    }
    // RED test (c) from the brief: a non-listed calendar does NOT exit
    expect(FLOW_3_POST_INITIAL.exits.some((x) => eventMatches(x, booked("USgPsktqRcuomdUgpShL")))).toBe(false);
  });
});
