import { describe, it, expect } from "vitest";
import { resolvePipelineMoves, PIPELINE_RULES } from "./pipeline.js";

const evt = (over = {}) => ({
  type: "booked", recognized: true, status: "booked",
  calendarId: "USgPsktqRcuomdUgpShL", contactId: "c1", appointmentId: "a1",
  startAt: "2026-07-20T15:00:00-07:00", modifiedBy: "customer", ...over,
});

describe("resolvePipelineMoves", () => {
  it("moves a booked discovery call to Booked 15-min Consultation", () => {
    const m = resolvePipelineMoves(evt());
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ pipeline: "Lead to Client Pipeline", stage: "Booked 15-min Consultation", mode: "shadow" });
  });

  it("moves an attended (showed) discovery call to Consultation Attended", () => {
    const m = resolvePipelineMoves(evt({ type: "showed" }));
    expect(m[0]).toMatchObject({ stage: "Consultation Attended" });
  });

  it("marks a cancelled/no-show discovery opportunity Lost (finding #6 fix)", () => {
    expect(resolvePipelineMoves(evt({ type: "cancelled" }))[0]).toMatchObject({ stage: "Lost", markLost: true });
    expect(resolvePipelineMoves(evt({ type: "noshow" }))[0]).toMatchObject({ stage: "Lost", markLost: true });
  });

  it("moves an initial in-person/virtual booking to Session Scheduled in the Single Session Pipeline", () => {
    for (const calendarId of ["G7OAnnJuFbMF6nQSlZVQ", "ySmht5hx4uZGEpgZrlCw"]) {
      const m = resolvePipelineMoves(evt({ calendarId, type: "confirmed" }));
      expect(m[0]).toMatchObject({ pipeline: "Single Session Pipeline", pipelineId: "VrqxizLOJ8UHYrc3g842", stage: "Session Scheduled" });
    }
  });

  it("moves a follow-up booking to Session Scheduled", () => {
    const m = resolvePipelineMoves(evt({ calendarId: "ZO1jlGfy01rsxVqicoSB", type: "confirmed" }));
    expect(m[0]).toMatchObject({ pipeline: "Single Session Pipeline", stage: "Session Scheduled" });
  });

  it("returns nothing for an unconfigured calendar or unrecognized event", () => {
    expect(resolvePipelineMoves(evt({ calendarId: "nope" }))).toEqual([]);
    expect(resolvePipelineMoves(evt({ recognized: false }))).toEqual([]);
    expect(resolvePipelineMoves(null)).toEqual([]);
  });

  it("every rule defaults to shadow mode (never writes to GHL until switched)", () => {
    expect(PIPELINE_RULES.every((r) => r.mode === "shadow")).toBe(true);
  });
});
