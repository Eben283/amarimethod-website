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
    expect(NO_SHOW_RECOVERY_WORKFLOW.trigger.contactModeByCalendar).toEqual({
      G7OAnnJuFbMF6nQSlZVQ: "contact",
      ySmht5hx4uZGEpgZrlCw: "contact",
      P7T6M1w8wtuRfwAqzOVw: "contact",
      wO5lnu7BOQOHEJ5YQU0f: "contact",
      waHmG2mHNThPfMVuNJWG: "contact",
    });
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

  it("pins the exact source copy and two source reschedule checks", () => {
    expect(NO_SHOW_RECOVERY_WORKFLOW.sourceGaps).toBeUndefined();
    expect(NO_SHOW_RECOVERY_WORKFLOW.sourceDecisionChecks).toEqual([
      expect.objectContaining({ at: "enroll+1440m", field: "appointmentRescheduled", equals: "false", falseBranch: "end", trueBranch: "regular-one-day-email" }),
      expect.objectContaining({ at: "enroll+2880m", field: "appointmentRescheduled", equals: "false", falseBranch: "end", trueBranch: "regular-two-day-email" }),
    ]);
    expect(NO_SHOW_RECOVERY_WORKFLOW.nodes[0].message.body).toContain("- Garrett");
    expect(NO_SHOW_RECOVERY_WORKFLOW.nodes[2].message).toEqual(expect.objectContaining({
      subject: "About your missed session", preheader: "Here's how to reschedule",
    }));
    expect(NO_SHOW_RECOVERY_WORKFLOW.nodes[2].message.body).toContain("{{rescheduleLink}}");
    expect(NO_SHOW_RECOVERY_WORKFLOW.nodes[3].message).toEqual(expect.objectContaining({
      subject: "Your body is waiting", preheader: "Whenever you're ready",
    }));
    expect(NO_SHOW_RECOVERY_WORKFLOW.nodes[3].message.body).toContain("https://www.amarimethod.com/booking");
  });

  it("still refuses any unrelated active workflow with unresolved source gaps", () => {
    expect(() => defineWorkflow({ ...NO_SHOW_RECOVERY_WORKFLOW, sourceGaps: ["unknown"], executionMode: "active" }))
      .toThrow("unresolved source gaps cannot be active");
  });
});
