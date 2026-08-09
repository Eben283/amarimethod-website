import { describe, it, expect, vi, beforeEach } from "vitest";

// Shadow flows never send, but engine.js imports the adapter for active mode — mock it and assert
// it is NEVER called while the default-shadow flow runs.
vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));

import { handleEvent, runSweep } from "./engine.js";
import { loadDueSteps } from "./store.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";

// Minimal stateful fake D1 (same shape as store.test.js's).
function fakeD1() {
  const enrollments = new Map();
  const steps = [];
  const events = [];
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
      if (/UPDATE reminder_steps SET status = \? WHERE enrollment_id = \? AND step_index = \?/.test(sql)) {
        const [status, id, idx] = a; let c = 0;
        for (const s of steps) if (s.enrollment_id === id && s.step_index === idx) { s.status = status; c++; }
        return { meta: { changes: c } };
      }
      if (/UPDATE reminder_enrollments SET status = 'cancelled'/.test(sql)) {
        const [id] = a; const e = enrollments.get(id); if (e) e.status = "cancelled";
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
  });
  return { prepare, _enrollments: enrollments, _steps: steps, _events: events };
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

describe("handleEvent — enroll", () => {
  it("enrolls a confirmed booking into the matching flow and logs it", async () => {
    const { actions } = await handleEvent(env, event(), NOW);
    expect(actions).toContainEqual({ engine: "reminder", action: "enroll", detail: { flowKey: "initial-in-person" } });
    expect(env.REMINDER_DB._enrollments.size).toBe(1);
    expect(env.REMINDER_DB._steps).toHaveLength(7);
    expect(env.REMINDER_DB._events.some((e) => e.action === "enrolled")).toBe(true);
  });

  it("is idempotent on a duplicate event (no double enroll)", async () => {
    await handleEvent(env, event(), NOW);
    const { actions } = await handleEvent(env, event(), NOW);
    expect(actions).toContainEqual(expect.objectContaining({ action: "enroll-noop" }));
    expect(env.REMINDER_DB._steps).toHaveLength(7);
  });

  it("ignores an event on an unconfigured calendar", async () => {
    const { actions } = await handleEvent(env, event({ calendarId: "not-a-flow-calendar" }), NOW);
    expect(actions).toHaveLength(0);
    expect(env.REMINDER_DB._enrollments.size).toBe(0);
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
