import { describe, expect, it } from "vitest";
import { backfillEnrollment, enroll } from "./enroll.js";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";
import { executableFlow } from "./workflow-definition.js";

const NOW = Date.parse("2026-08-12T09:00:00-07:00");
const START = "2026-08-14T10:00:00-07:00";

function booking(reminderPreference) {
  return {
    recognized: true,
    type: "confirmed",
    appointmentEventType: "normal",
    calendarId: "SKDVOL8wtUN6Ne0ppbC9",
    contactId: "follow-up-client",
    appointmentId: `follow-up-${reminderPreference || "full"}`,
    startAt: START,
    context: { reminderPreference },
  };
}

describe("Follow-up session reminder workflow", () => {
  it("matches GHL's normal-event filter without inventing a modified-by restriction", () => {
    const flow = executableFlow(FOLLOW_UP_WORKFLOW);
    expect(flow.definitionVersion).toBe(2);
    expect(flow.enrollOn.eventTypes).toEqual(["normal"]);
    expect(flow.enrollOn.modifiedBy).toBeUndefined();
    expect(enroll({ ...booking("full"), appointmentEventType: "recurring" }, flow, NOW)).toBe(null);
  });

  it("uses the one owned document to schedule the documented short-notice path", () => {
    const flow = executableFlow(FOLLOW_UP_WORKFLOW);
    const enrollment = enroll(booking("some"), flow, NOW);

    expect(enrollment.steps.map((step) => step.template)).toEqual([
      "remove-no-show-series",
      "booked-internal",
      "confirmation",
      "one-hour-sms",
      "one-hour-internal",
    ]);
  });

  it("does not schedule a reminder when the owned preference is none", () => {
    const flow = executableFlow(FOLLOW_UP_WORKFLOW);
    const enrollment = enroll(booking("none"), flow, NOW);

    expect(enrollment.steps.map((step) => step.template)).toEqual([
      "remove-no-show-series",
      "booked-internal",
      "confirmation",
    ]);
  });

  it("backfills only future Follow-Up work and never replays the booking-time actions", () => {
    const flow = executableFlow(FOLLOW_UP_WORKFLOW);
    const enrollment = backfillEnrollment(booking("full"), flow, NOW);

    expect(enrollment.steps.slice(0, 3).map((step) => step.status)).toEqual([
      "skipped", "skipped", "skipped",
    ]);
    expect(enrollment.steps.slice(3).every((step) => step.status === "pending")).toBe(true);
  });
});
