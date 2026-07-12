import { describe, it, expect, beforeEach } from "vitest";
import { contactAutomationView, failuresView } from "./automation-views.js";

const NOW = Date.parse("2026-07-12T10:00:00-07:00");
const DAY = 86400000;

// Read-only fake of the shared amari-automation D1 with a little seeded state.
function fakeD1(seed = {}) {
  const t = {
    reminder_enrollments: seed.reminderEnrollments || [],
    reminder_steps: seed.reminderSteps || [],
    nurture_enrollments: seed.nurtureEnrollments || [],
    nurture_steps: seed.nurtureSteps || [],
    upgrade_offer_timers: seed.timers || [],
    purchase_confirmations: seed.confirmations || [],
    lp_onboarding_sends: seed.lpSends || [],
    automation_events: seed.events || [],
  };
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async all() {
      const a = this._args;
      if (/FROM reminder_enrollments WHERE contact_id/.test(sql)) {
        return { results: t.reminder_enrollments.filter((r) => r.contact_id === a[0]) };
      }
      if (/FROM reminder_steps s\s+JOIN reminder_enrollments e/.test(sql)) {
        return {
          results: t.reminder_steps
            .filter((s) => t.reminder_enrollments.some((e) => e.enrollment_id === s.enrollment_id && e.contact_id === a[0])),
        };
      }
      if (/FROM nurture_enrollments WHERE contact_id/.test(sql)) {
        return { results: t.nurture_enrollments.filter((r) => r.contact_id === a[0]) };
      }
      if (/FROM nurture_steps s\s+JOIN nurture_enrollments e/.test(sql)) {
        return {
          results: t.nurture_steps
            .filter((s) => t.nurture_enrollments.some((e) => e.enrollment_id === s.enrollment_id && e.contact_id === a[0])),
        };
      }
      if (/FROM upgrade_offer_timers WHERE contact_id/.test(sql)) {
        return { results: t.upgrade_offer_timers.filter((r) => r.contact_id === a[0]) };
      }
      if (/FROM purchase_confirmations WHERE contact_id/.test(sql)) {
        return { results: t.purchase_confirmations.filter((r) => r.contact_id === a[0]) };
      }
      if (/FROM lp_onboarding_sends WHERE contact_id/.test(sql)) {
        return { results: t.lp_onboarding_sends.filter((r) => r.contact_id === a[0]) };
      }
      if (/FROM automation_events WHERE contact_id/.test(sql)) {
        const [contactId, limit] = a;
        return {
          results: t.automation_events
            .filter((e) => e.contact_id === contactId)
            .sort((x, y) => y.ts - x.ts)
            .slice(0, limit),
        };
      }
      if (/FROM automation_events WHERE outcome IN/.test(sql)) {
        const [sinceMs, limit] = a;
        return {
          results: t.automation_events
            .filter((e) => ["failed", "bounced", "error"].includes(e.outcome) && e.ts >= sinceMs)
            .sort((x, y) => y.ts - x.ts)
            .slice(0, limit),
        };
      }
      return { results: [] };
    },
  });
  return { prepare };
}

const seed = () => ({
  reminderEnrollments: [
    { enrollment_id: "initial-in-person:appt_1", flow_key: "initial-in-person", appointment_id: "appt_1", contact_id: "cont_1", calendar_id: "cal", start_at: "2026-07-20T15:00:00-07:00", start_ms: NOW + 8 * DAY, enrolled_at: NOW, status: "active" },
  ],
  reminderSteps: [
    { enrollment_id: "initial-in-person:appt_1", step_index: 0, at: "enroll", type: "email", template: "confirmation", due_at: NOW, status: "would_send" },
    { enrollment_id: "initial-in-person:appt_1", step_index: 2, at: "start-1440m", type: "email", template: "day-before", due_at: NOW + 7 * DAY, status: "pending" },
    { enrollment_id: "initial-in-person:appt_1", step_index: 3, at: "start-60m", type: "sms", template: "one-hour-sms", due_at: NOW + 8 * DAY, status: "pending" },
  ],
  nurtureEnrollments: [
    { enrollment_id: "flow-1-quiz:cont_1", sequence_id: "flow-1-quiz", contact_id: "cont_1", entered_at: NOW - DAY, status: "exited", guard_unchecked: 0 },
  ],
  nurtureSteps: [
    { enrollment_id: "flow-1-quiz:cont_1", step_index: 0, after: "0d", kind: "email", template: "f1-email-1-quiz-results", due_at: NOW - DAY, status: "would_send" },
    { enrollment_id: "flow-1-quiz:cont_1", step_index: 1, after: "+3d", kind: "branch", template: null, due_at: NOW + 2 * DAY, status: "exited" },
  ],
  timers: [{ contact_id: "cont_1", scheduled_at: NOW, due_at: NOW + 3 * DAY, status: "pending" }],
  confirmations: [{ ref: "inv:100", contact_id: "cont_1", series_type: "4-session", status: "would_send", ts: NOW }],
  lpSends: [],
  events: [
    { id: 1, ts: NOW - DAY, engine: "nurture", flow_key: "flow-1-quiz", contact_id: "cont_1", appointment_id: null, step_index: null, action: "enrolled", outcome: "enrolled", channel: null, message_ref: null, detail: '{"via":"quiz.submitted"}' },
    { id: 2, ts: NOW, engine: "reminder", flow_key: "initial-in-person", contact_id: "cont_1", appointment_id: "appt_1", step_index: 0, action: "would_send", outcome: "would_send", channel: "email", message_ref: null, detail: '{"template":"confirmation"}' },
    { id: 3, ts: NOW - 2 * DAY, engine: "reminder", flow_key: "initial-in-person", contact_id: "cont_2", appointment_id: "appt_9", step_index: 1, action: "send", outcome: "failed", channel: "sms", message_ref: null, detail: '{"error":"rate limited"}' },
  ],
});

let db;
beforeEach(() => { db = fakeD1(seed()); });

describe("contactAutomationView — the per-contact timeline (DASHBOARD-PLAN v1)", () => {
  it("returns every engine's enrollments normalized, with the next pending step resolved", async () => {
    const v = await contactAutomationView(db, "cont_1");
    expect(v.enrollments).toHaveLength(2);

    const reminder = v.enrollments.find((e) => e.engine === "reminder");
    expect(reminder.key).toBe("initial-in-person");
    expect(reminder.status).toBe("active");
    expect(reminder.nextStep).toEqual(expect.objectContaining({ stepIndex: 2, template: "day-before", dueAt: NOW + 7 * DAY }));
    expect(reminder.steps).toHaveLength(3);

    const nurture = v.enrollments.find((e) => e.engine === "nurture");
    expect(nurture.key).toBe("flow-1-quiz");
    expect(nurture.status).toBe("exited");
    expect(nurture.nextStep).toBeNull(); // exited — nothing pending
  });

  it("includes the purchase-cluster state (offer timer, confirmations, LP onboarding)", async () => {
    const v = await contactAutomationView(db, "cont_1");
    expect(v.upgradeOffer).toEqual(expect.objectContaining({ status: "pending", due_at: NOW + 3 * DAY }));
    expect(v.confirmations).toHaveLength(1);
    expect(v.lpOnboarding).toBeNull();
  });

  it("returns the event history reverse-chron with detail parsed", async () => {
    const v = await contactAutomationView(db, "cont_1");
    expect(v.events.map((e) => e.action)).toEqual(["would_send", "enrolled"]);
    expect(v.events[0].detail).toEqual({ template: "confirmation" });
  });

  it("an unknown contact returns an empty view, not an error", async () => {
    const v = await contactAutomationView(db, "stranger");
    expect(v.enrollments).toHaveLength(0);
    expect(v.events).toHaveLength(0);
    expect(v.upgradeOffer).toBeNull();
  });
});

describe("failuresView — the failures table (DASHBOARD-PLAN v1)", () => {
  it("returns failed/bounced/error events since the cutoff, newest first, detail parsed", async () => {
    const rows = await failuresView(db, { sinceMs: NOW - 7 * DAY });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("failed");
    expect(rows[0].contactId).toBe("cont_2");
    expect(rows[0].detail).toEqual({ error: "rate limited" });
  });

  it("respects the cutoff", async () => {
    expect(await failuresView(db, { sinceMs: NOW - DAY })).toHaveLength(0);
  });
});
