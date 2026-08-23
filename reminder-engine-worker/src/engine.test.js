import { describe, it, expect, vi, beforeEach } from "vitest";

// Shadow flows never send, but engine.js imports the adapter for active mode — mock it and assert
// it is NEVER called while the default-shadow flow runs.
vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));

import { handleEvent, mergeExecutionFlows, runSweep } from "./engine.js";
import { loadDueSteps } from "./store.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { INITIAL_VIRTUAL_WORKFLOW } from "./initial-virtual-workflow.js";

// Minimal stateful fake D1 (same shape as store.test.js's).
function fakeD1() {
  const enrollments = new Map();
  const steps = [];
  const events = [];
  const workflowDocuments = new Map();
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/INSERT INTO reminder_enrollments/.test(sql)) {
        const [id, flow_key, definition_version, appointment_id, contact_id, calendar_id, start_at, start_ms, enrolled_at, status] = a;
        if (enrollments.has(id)) return { meta: { changes: 0 } };
        enrollments.set(id, { enrollment_id: id, flow_key, definition_version, appointment_id, contact_id, calendar_id, start_at, start_ms, enrolled_at, status });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO reminder_steps/.test(sql)) {
        const [enrollment_id, step_index, at, type, template, due_at, status] = a;
        if (steps.some((step) => step.enrollment_id === enrollment_id && step.step_index === step_index)) {
          return { meta: { changes: 0 } };
        }
        steps.push({ enrollment_id, step_index, at, type, template, due_at, status });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO automation_events/.test(sql)) {
        const [ts, engine, flow_key, definition_version, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail] = a;
        events.push({ ts, engine, flow_key, definition_version, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE reminder_steps SET status = 'cancelled' WHERE enrollment_id = \? AND status = 'pending'/.test(sql)) {
        const [id] = a; let c = 0;
        for (const s of steps) if (s.enrollment_id === id && s.status === "pending") { s.status = "cancelled"; c++; }
        return { meta: { changes: c } };
      }
      if (/UPDATE reminder_steps SET status = 'cancelled'\s+WHERE status = 'pending' AND enrollment_id IN/.test(sql)) {
        const [flowKey, contactId] = a; let c = 0;
        for (const s of steps) {
          const e = enrollments.get(s.enrollment_id);
          if (s.status === "pending" && e && e.flow_key === flowKey && e.contact_id === contactId && e.status === "active") { s.status = "cancelled"; c++; }
        }
        return { meta: { changes: c } };
      }
      if (/UPDATE reminder_steps\s+SET due_at = \?, status = \?/.test(sql)) {
        const [dueAt, status, id, stepIndex] = a; let c = 0;
        for (const s of steps) {
          if (s.enrollment_id === id && s.step_index === stepIndex && s.status === "pending") {
            s.due_at = dueAt;
            s.status = status;
            c++;
          }
        }
        return { meta: { changes: c } };
      }
      if (/UPDATE reminder_steps SET status = \? WHERE enrollment_id = \? AND step_index = \?/.test(sql)) {
        const [status, id, idx] = a; let c = 0;
        for (const s of steps) if (s.enrollment_id === id && s.step_index === idx) { s.status = status; c++; }
        return { meta: { changes: c } };
      }
      if (/UPDATE reminder_enrollments SET status = 'cancelled'/.test(sql)) {
        if (/flow_key = \? AND contact_id = \?/.test(sql)) {
          const [flowKey, contactId] = a; let c = 0;
          for (const e of enrollments.values()) {
            if (e.flow_key === flowKey && e.contact_id === contactId && e.status === "active") { e.status = "cancelled"; c++; }
          }
          return { meta: { changes: c } };
        }
        const [id] = a; const e = enrollments.get(id); if (e) e.status = "cancelled";
        return { meta: { changes: e ? 1 : 0 } };
      }
      if (/UPDATE reminder_enrollments SET start_at = \?, start_ms = \?/.test(sql)) {
        const [startAt, startMs, id] = a; const e = enrollments.get(id);
        if (e && e.status === "active") { e.start_at = startAt; e.start_ms = startMs; }
        return { meta: { changes: e ? 1 : 0 } };
      }
      return { meta: { changes: 0 } };
    },
      async all() {
      const a = this._args;
      if (/FROM reminder_steps s\s+JOIN reminder_enrollments e/.test(sql)) {
        const [nowMs, limit] = a;
        const rows = steps
          .filter((s) => s.status === "pending" && s.due_at <= nowMs)
          .map((s) => ({ s, e: enrollments.get(s.enrollment_id) }))
          .filter(({ e }) => e && e.status === "active")
          .sort((x, y) => x.s.due_at - y.s.due_at)
          .slice(0, limit)
          .map(({ s, e }) => ({
            enrollment_id: s.enrollment_id, step_index: s.step_index, at: s.at, type: s.type, template: s.template, due_at: s.due_at, step_status: s.status,
            flow_key: e.flow_key, definition_version: e.definition_version, appointment_id: e.appointment_id, contact_id: e.contact_id, calendar_id: e.calendar_id, start_at: e.start_at, start_ms: e.start_ms,
          }));
        return { results: rows };
      }
      return { results: [] };
    },
    async first() {
      if (/SELECT document FROM workflow_versions WHERE workflow_id = \? AND state = 'published'/.test(sql)) {
        const document = workflowDocuments.get(this._args[0]);
        return document ? { document: JSON.stringify(document) } : null;
      }
      const [id] = this._args;
      if (/SELECT start_at, status FROM reminder_enrollments/.test(sql)) {
        const record = enrollments.get(id);
        return record ? { start_at: record.start_at, status: record.status } : null;
      }
      if (/SELECT status FROM reminder_steps/.test(sql)) {
        const record = steps.find((step) => step.enrollment_id === id && step.template === this._args[1]);
        return record ? { status: record.status } : null;
      }
      return null;
    },
  });
  return { prepare, _enrollments: enrollments, _steps: steps, _events: events, _workflowDocuments: workflowDocuments };
}

const START = Date.parse("2026-07-20T15:00:00-07:00");
const NOW = Date.parse("2026-07-18T15:00:00-07:00"); // 2 days before → enroll steps due, timed steps future
const event = (over = {}) => ({
  type: "confirmed", recognized: true, status: "confirmed",
  calendarId: "G7OAnnJuFbMF6nQSlZVQ", contactId: "cont_1", appointmentId: "appt_1",
  startAt: "2026-07-20T15:00:00-07:00", modifiedBy: "customer", ...over,
});

let env;
beforeEach(() => { env = { REMINDER_DB: fakeD1() }; vi.clearAllMocks(); });

describe("canonical workflow routing", () => {
  it("adds a staged Follow-Up document to the executable event routes", () => {
    const routed = mergeExecutionFlows(
      [{ flowKey: "initial-in-person" }, { flowKey: "discovery-call" }],
      [{ flowKey: "initial-in-person" }, { flowKey: "follow-up-session-reminders" }],
    );
    expect(routed.map((flow) => flow.flowKey)).toEqual([
      "discovery-call", "initial-in-person", "follow-up-session-reminders",
    ]);
  });
});

describe("handleEvent — enroll", () => {
  it("enrolls a confirmed booking into the matching flow and logs it", async () => {
    const { actions } = await handleEvent(env, event(), NOW);
    expect(actions).toContainEqual({ engine: "reminder", action: "enroll", detail: { flowKey: "initial-in-person" } });
    expect(env.REMINDER_DB._enrollments.size).toBe(1);
    expect(env.REMINDER_DB._steps).toHaveLength(6);
    expect(env.REMINDER_DB._events.some((e) => e.action === "enrolled")).toBe(true);
  });

  it("is idempotent on a duplicate event (no double enroll)", async () => {
    await handleEvent(env, event(), NOW);
    const { actions } = await handleEvent(env, event(), NOW);
    expect(actions).toContainEqual(expect.objectContaining({ action: "enroll-noop" }));
    expect(env.REMINDER_DB._steps).toHaveLength(6);
  });

  it("retimes pending reminders when the same appointment is rescheduled", async () => {
    await handleEvent(env, event(), NOW);
    const movedStart = "2026-07-22T15:00:00-07:00";
    const { actions } = await handleEvent(env, event({ startAt: movedStart }), NOW);

    expect(actions).toContainEqual(expect.objectContaining({
      engine: "reminder",
      action: "reschedule",
      detail: { flowKey: "initial-in-person" },
    }));
    expect(env.REMINDER_DB._enrollments.get("initial-in-person:appt_1").start_at).toBe(movedStart);
    expect(env.REMINDER_DB._steps.find((step) => step.step_index === 2).due_at)
      .toBe(Date.parse(movedStart) - 1440 * 60_000);
    expect(env.REMINDER_DB._steps).toHaveLength(6); // the original run is retimed, never duplicated
  });

  it("never reopens a shadowed confirmation when the appointment is rescheduled", async () => {
    await handleEvent(env, event(), NOW);
    await runSweep(env, NOW); // the two immediate confirmation steps are now immutable would-send evidence

    await handleEvent(env, event({ startAt: "2026-07-22T15:00:00-07:00" }), NOW);

    expect(env.REMINDER_DB._steps.filter((step) => step.status === "would_send")).toHaveLength(2);
    expect(env.REMINDER_DB._steps.find((step) => step.step_index === 0).due_at).toBe(NOW);
    expect(env.REMINDER_DB._steps.find((step) => step.step_index === 1).due_at).toBe(NOW);
  });

  it("queues the v4 reschedule confirmation only after the original confirmation was sent", async () => {
    await handleEvent(env, event(), NOW);
    env.REMINDER_DB._steps.find((step) => step.template === "confirmation").status = "sent";

    const movedStart = "2026-07-22T15:00:00-07:00";
    await handleEvent(env, event({ startAt: movedStart }), NOW + 1_000);

    const queued = env.REMINDER_DB._steps.find((step) => step.template === "reschedule-confirmation");
    expect(queued).toMatchObject({ at: "reschedule", type: "email", due_at: NOW + 1_000, status: "pending" });
    expect(env.REMINDER_DB._events).toContainEqual(expect.objectContaining({
      action: "reschedule_confirmation_queued", outcome: "queued", channel: "email",
    }));
  });

  it("queues one updated virtual confirmation after a sent welcome is rescheduled", async () => {
    env.REMINDER_DB._workflowDocuments.set("initial-virtual", INITIAL_VIRTUAL_WORKFLOW);
    const virtual = event({
      calendarId: "ySmht5hx4uZGEpgZrlCw", appointmentId: "virtual_1", modifiedBy: "user",
    });
    await handleEvent(env, virtual, NOW);
    env.REMINDER_DB._steps.find((step) => step.template === "welcome").status = "sent";

    await handleEvent(env, { ...virtual, startAt: "2026-07-23T15:00:00-07:00" }, NOW + 2_000);

    expect(env.REMINDER_DB._steps.filter((step) => step.template === "reschedule-confirmation"))
      .toEqual([expect.objectContaining({ at: "reschedule", type: "email", due_at: NOW + 2_000, status: "pending" })]);
    expect(env.REMINDER_DB._events).toContainEqual(expect.objectContaining({
      flow_key: "initial-virtual", action: "reschedule_confirmation_queued", outcome: "queued",
    }));
  });

  it("queues the virtual reschedule confirmation after the welcome was observed in shadow", async () => {
    env.REMINDER_DB._workflowDocuments.set("initial-virtual", INITIAL_VIRTUAL_WORKFLOW);
    const virtual = event({
      calendarId: "ySmht5hx4uZGEpgZrlCw", appointmentId: "virtual_shadow", modifiedBy: "user",
    });
    await handleEvent(env, virtual, NOW);
    await runSweep(env, NOW);

    await handleEvent(env, { ...virtual, startAt: "2026-07-23T15:00:00-07:00" }, NOW + 2_000);

    expect(env.REMINDER_DB._steps.filter((step) => step.template === "reschedule-confirmation"))
      .toEqual([expect.objectContaining({ at: "reschedule", type: "email", due_at: NOW + 2_000, status: "pending" })]);
  });

  it("enrolls the actorless event shape emitted by the shared webhook for Initial Virtual", async () => {
    env.REMINDER_DB._workflowDocuments.set("initial-virtual", INITIAL_VIRTUAL_WORKFLOW);
    const virtual = event({
      calendarId: "ySmht5hx4uZGEpgZrlCw", appointmentId: "virtual_actorless", modifiedBy: null,
    });

    await handleEvent(env, virtual, NOW);

    expect(env.REMINDER_DB._enrollments.get("initial-virtual:virtual_actorless"))
      .toEqual(expect.objectContaining({ status: "active", definition_version: 4 }));
  });

  it("queues a fresh virtual notice when a later reschedule returns to an earlier start time", async () => {
    env.REMINDER_DB._workflowDocuments.set("initial-virtual", INITIAL_VIRTUAL_WORKFLOW);
    const virtual = event({
      calendarId: "ySmht5hx4uZGEpgZrlCw", appointmentId: "virtual_return", modifiedBy: "customer",
    });
    await handleEvent(env, virtual, NOW);
    env.REMINDER_DB._steps.find((step) => step.template === "welcome").status = "sent";

    const firstMove = "2026-07-23T15:00:00-07:00";
    await handleEvent(env, { ...virtual, startAt: firstMove }, NOW + 1_000);
    env.REMINDER_DB._steps.find((step) => step.template === "reschedule-confirmation" && step.status === "pending").status = "sent";
    await handleEvent(env, { ...virtual, startAt: "2026-07-24T15:00:00-07:00" }, NOW + 2_000);
    env.REMINDER_DB._steps.find((step) => step.template === "reschedule-confirmation" && step.status === "pending").status = "sent";
    await handleEvent(env, { ...virtual, startAt: firstMove }, NOW + 3_000);

    expect(env.REMINDER_DB._steps.filter((step) => step.template === "reschedule-confirmation"))
      .toHaveLength(3);
  });

  it("ignores an event on an unconfigured calendar", async () => {
    const { actions } = await handleEvent(env, event({ calendarId: "not-a-flow-calendar" }), NOW);
    expect(actions).toHaveLength(0);
    expect(env.REMINDER_DB._enrollments.size).toBe(0);
  });

  it("does not publish or shadow Initial Virtual during an ordinary deployment", async () => {
    const { actions } = await handleEvent(env, event({
      calendarId: "ySmht5hx4uZGEpgZrlCw", appointmentId: "virtual_1", modifiedBy: "user",
    }), NOW);
    expect(actions).not.toContainEqual(expect.objectContaining({ engine: "reminder", detail: { flowKey: "initial-virtual" } }));
    expect(env.REMINDER_DB._enrollments.get("initial-virtual:virtual_1")).toBeUndefined();
    expect((await runSweep(env, NOW)).would_send).toBe(0);
    expect(sendConversationMessage).not.toHaveBeenCalled();
  });
});

describe("handleEvent — cancel", () => {
  it("cancels pending steps on a cancelled event", async () => {
    await handleEvent(env, event(), NOW);
    const { actions } = await handleEvent(env, event({ type: "cancelled" }), NOW);
    expect(actions).toContainEqual(expect.objectContaining({ action: "cancel" }));
    expect(await loadDueSteps(env.REMINDER_DB, START)).toHaveLength(0); // nothing left to fire
  });
});

describe("Assessment no-show recovery", () => {
  it("shadows the recovery sequence and exits it when the person confirms a new Assessment booking", async () => {
    const noShow = event({
      type: "noshow", status: "no-show", calendarId: "EM6vB2mq7EAdGCbUb3j1",
      appointmentId: "assessment-missed", contactId: "assessment-contact",
    });
    const { actions } = await handleEvent(env, noShow, NOW);
    expect(actions).toContainEqual({ engine: "reminder", action: "enroll", detail: { flowKey: "assessment-no-show" } });
    expect(env.REMINDER_DB._steps.filter((step) => step.enrollment_id === "assessment-no-show:assessment-missed")).toHaveLength(3);
    expect((await runSweep(env, NOW)).would_send).toBe(1);
    expect(sendConversationMessage).not.toHaveBeenCalled();

    const rebook = event({
      calendarId: "EM6vB2mq7EAdGCbUb3j1", appointmentId: "assessment-rebooked",
      contactId: "assessment-contact", type: "confirmed",
    });
    const out = await handleEvent(env, rebook, NOW + 60_000);
    expect(out.actions).toContainEqual(expect.objectContaining({
      engine: "reminder", action: "exit", detail: expect.objectContaining({ flowKey: "assessment-no-show", cancelledSteps: 2, exitedEnrollments: 1 }),
    }));
    expect(env.REMINDER_DB._enrollments.get("assessment-no-show:assessment-missed").status).toBe("cancelled");
  });
});

describe("partner in-person reminder slice", () => {
  it("shadows the documented confirmation sequence and suppresses it on cancellation", async () => {
    const partner = event({
      calendarId: "lfsnaiGiLNL2z12pLKDP",
      appointmentId: "partner-appt-1",
      contactId: "partner-contact-1",
    });
    const { actions } = await handleEvent(env, partner, NOW);
    expect(actions).toContainEqual({ engine: "reminder", action: "enroll", detail: { flowKey: "partner-initial-in-person" } });
    expect(env.REMINDER_DB._steps).toHaveLength(6);

    const counts = await runSweep(env, NOW);
    expect(counts.would_send).toBe(2);
    expect(sendConversationMessage).not.toHaveBeenCalled();

    await handleEvent(env, event({
      calendarId: "lfsnaiGiLNL2z12pLKDP",
      appointmentId: "partner-appt-1",
      contactId: "partner-contact-1",
      type: "cancelled",
    }), NOW);
    expect(await loadDueSteps(env.REMINDER_DB, START + 2 * 24 * 60 * 60_000)).toHaveLength(0);
  });
});

describe("runSweep — shadow (default)", () => {
  it("logs would_send for due steps and NEVER calls the send adapter", async () => {
    await handleEvent(env, event(), NOW);
    const counts = await runSweep(env, NOW); // only the 2 'enroll'-timed steps are due at NOW
    expect(counts.would_send).toBe(2);
    expect(counts.sent).toBe(0);
    expect(sendConversationMessage).not.toHaveBeenCalled();
    // those steps are now out of the due-queue
    expect(await loadDueSteps(env.REMINDER_DB, NOW)).toHaveLength(0);
    expect(env.REMINDER_DB._events.filter((e) => e.outcome === "would_send")).toHaveLength(2);
  });
});

describe("handleEvent — pipeline moves (shadow)", () => {
  it("logs a would_move for a booked discovery call and never sends", async () => {
    const { actions } = await handleEvent(env, event({ calendarId: "USgPsktqRcuomdUgpShL", type: "booked" }), NOW);
    expect(actions).toContainEqual(expect.objectContaining({ engine: "pipeline", action: "would_move", detail: expect.objectContaining({ stage: "Booked 15-min Consultation" }) }));
    const moveEvents = env.REMINDER_DB._events.filter((e) => e.engine === "pipeline" && e.outcome === "would_move");
    expect(moveEvents).toHaveLength(1);
    expect(sendConversationMessage).not.toHaveBeenCalled();
  });

  it("an initial in-person booking both enrolls the reminder flow AND logs a pipeline move", async () => {
    const { actions } = await handleEvent(env, event({ calendarId: "G7OAnnJuFbMF6nQSlZVQ", type: "confirmed" }), NOW);
    expect(actions).toContainEqual(expect.objectContaining({ engine: "reminder", action: "enroll" }));
    expect(actions).toContainEqual(expect.objectContaining({ engine: "pipeline", action: "would_move", detail: expect.objectContaining({ stage: "Session Scheduled" }) }));
  });
});
