import { describe, expect, it } from "vitest";
import { enroll } from "./enroll.js";
import { NO_SHOW_RECOVERY, NO_SHOW_RECOVERY_WORKFLOW } from "./no-show-recovery-workflow.js";
import { defineWorkflow } from "./workflow-definition.js";

const NOW = Date.parse("2026-08-23T10:00:00-07:00");
const event = (affiliatePartner) => ({
  recognized: true,
  type: "noshow",
  appointmentEventType: "normal",
  calendarId: "ySmht5hx4uZGEpgZrlCw",
  appointmentId: "appt-no-show",
  contactId: "contact-no-show",
  startAt: "2026-08-23T09:00:00-07:00",
  context: { affiliatePartner },
});

describe("No Show Email SMS series source stage", () => {
  it("pins the exact 11-calendar GHL trigger and remains shadow-only", () => {
    expect(NO_SHOW_RECOVERY_WORKFLOW.executionMode).toBe("shadow");
    expect(NO_SHOW_RECOVERY_WORKFLOW.trigger.statuses).toEqual(["noshow"]);
    expect(NO_SHOW_RECOVERY_WORKFLOW.trigger.eventTypes).toEqual(["normal"]);
    expect(NO_SHOW_RECOVERY_WORKFLOW.trigger.calendarIds).toHaveLength(11);
    expect(NO_SHOW_RECOVERY.exitOn).toEqual(["confirmed"]);
  });

  it("creates only the soft affiliate SMS for affiliate partners", () => {
    const enrollment = enroll(event("true"), NO_SHOW_RECOVERY, NOW);
    expect(enrollment.steps.map((step) => `${step.at}:${step.template}`)).toEqual(["enroll:affiliate-soft-sms"]);
  });

  it("creates the regular SMS and two timed emails for non-affiliates", () => {
    const enrollment = enroll(event("false"), NO_SHOW_RECOVERY, NOW);
    expect(enrollment.steps.map((step) => `${step.at}:${step.template}`)).toEqual([
      "enroll:reschedule-sms", "enroll+1440m:one-day-follow-up", "enroll+2880m:two-day-follow-up",
    ]);
  });

  it("fails closed with zero message steps when affiliate status is unreadable", () => {
    expect(enroll(event("unknown"), NO_SHOW_RECOVERY, NOW).steps).toEqual([]);
  });

  it("keeps every unknown live-builder value explicit and non-releasable", () => {
    expect(NO_SHOW_RECOVERY_WORKFLOW.sourceGaps).toHaveLength(4);
    expect(JSON.stringify(NO_SHOW_RECOVERY_WORKFLOW)).toContain("CONTENT UNKNOWN — extract from GHL");
    expect(JSON.stringify(NO_SHOW_RECOVERY_WORKFLOW)).toContain("TARGET UNKNOWN — extract from GHL");
    expect(() => defineWorkflow({ ...NO_SHOW_RECOVERY_WORKFLOW, executionMode: "active" }))
      .toThrow("unresolved source gaps cannot be active");
  });
});
