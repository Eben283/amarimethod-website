import { describe, it, expect, beforeEach } from "vitest";
import { enrollmentId, saveEnrollment, loadDueSteps, markStep, appendEvent, cancelEnrollment } from "./store.js";

// Stateful fake of the D1 binding — models exactly the queries store.js issues, the way
// attendance-claim.test.js models its INSERT. prepare().bind().run()/.all().
function fakeD1() {
  const enrollments = new Map();
  const steps = [];
  const events = [];
  function prepare(sql) {
    return {
      _args: [],
      bind(...args) { this._args = args; return this; },
      async run() {
        const a = this._args;
        if (/INSERT INTO reminder_enrollments/.test(sql)) {
          const [id, flow_key, appointment_id, contact_id, calendar_id, start_at, start_ms, enrolled_at, status] = a;
          if (enrollments.has(id)) return { meta: { changes: 0 } };
          enrollments.set(id, { enrollment_id: id, flow_key, appointment_id, contact_id, calendar_id, start_at, start_ms, enrolled_at, status });
          return { meta: { changes: 1 } };
        }
        if (/INSERT INTO reminder_steps/.test(sql)) {
          const [enrollment_id, step_index, at, type, template, due_at, status] = a;
          steps.push({ enrollment_id, step_index, at, type, template, due_at, status });
          return { meta: { changes: 1 } };
        }
        if (/INSERT INTO automation_events/.test(sql)) {
          const [ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail] = a;
          events.push({ ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE reminder_steps SET status = 'cancelled' WHERE enrollment_id = \? AND status = 'pending'/.test(sql)) {
          const [id] = a;
          let changes = 0;
          for (const s of steps) if (s.enrollment_id === id && s.status === "pending") { s.status = "cancelled"; changes++; }
          return { meta: { changes } };
        }
        if (/UPDATE reminder_steps SET status = \? WHERE enrollment_id = \? AND step_index = \?/.test(sql)) {
          const [status, id, step_index] = a;
          let changes = 0;
          for (const s of steps) if (s.enrollment_id === id && s.step_index === step_index) { s.status = status; changes++; }
          return { meta: { changes } };
        }
        if (/UPDATE reminder_enrollments SET status = 'cancelled'/.test(sql)) {
          const [id] = a;
          const e = enrollments.get(id);
          if (e) e.status = "cancelled";
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
              flow_key: e.flow_key, appointment_id: e.appointment_id, contact_id: e.contact_id, calendar_id: e.calendar_id, start_at: e.start_at, start_ms: e.start_ms,
            }));
          return { results: rows };
        }
        return { results: [] };
      },
    };
  }
  return { prepare, _enrollments: enrollments, _steps: steps, _events: events };
}

const NOW = 1_000_000;
const enrollment = (over = {}) => ({
  flowKey: "initial-in-person",
  appointmentId: "a1",
  contactId: "c1",
  calendarId: "cal",
  startAt: "2026-07-20T15:00:00-07:00",
  startMs: 5_000_000,
  enrolledAt: NOW,
  status: "active",
  steps: [
    { stepIndex: 0, at: "enroll", type: "email", template: "confirmation", dueAt: NOW - 10, status: "pending" },
    { stepIndex: 1, at: "start-60m", type: "sms", template: "one-hour-sms", dueAt: NOW + 100_000, status: "pending" },
  ],
  ...over,
});

let db;
beforeEach(() => { db = fakeD1(); });

describe("enrollmentId", () => {
  it("joins flowKey and appointmentId", () => {
    expect(enrollmentId("initial-in-person", "a1")).toBe("initial-in-person:a1");
  });
});

describe("saveEnrollment", () => {
  it("creates the enrollment and its steps", async () => {
    const out = await saveEnrollment(db, enrollment());
    expect(out).toEqual({ created: true, enrollmentId: "initial-in-person:a1" });
    expect(db._enrollments.size).toBe(1);
    expect(db._steps).toHaveLength(2);
  });

  it("is idempotent: a duplicate booking event does not double-enroll", async () => {
    await saveEnrollment(db, enrollment());
    const second = await saveEnrollment(db, enrollment());
    expect(second.created).toBe(false);
    expect(db._steps).toHaveLength(2); // not 4
  });
});

describe("loadDueSteps", () => {
  it("returns only pending steps whose time has come, shaped for processStep", async () => {
    await saveEnrollment(db, enrollment());
    const due = await loadDueSteps(db, NOW);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      enrollmentId: "initial-in-person:a1",
      enrollment: { flowKey: "initial-in-person", contactId: "c1", appointmentId: "a1" },
      step: { stepIndex: 0, type: "email", status: "pending" },
    });
  });

  it("excludes future steps and steps on cancelled enrollments", async () => {
    await saveEnrollment(db, enrollment());
    await cancelEnrollment(db, "initial-in-person:a1");
    expect(await loadDueSteps(db, NOW)).toHaveLength(0);
  });
});

describe("markStep", () => {
  it("advances a step out of the due-queue", async () => {
    await saveEnrollment(db, enrollment());
    await markStep(db, "initial-in-person:a1", 0, "sent");
    expect(await loadDueSteps(db, NOW)).toHaveLength(0);
  });
});

describe("cancelEnrollment", () => {
  it("cancels the enrollment and its pending steps, leaving sent history intact", async () => {
    await saveEnrollment(db, enrollment());
    await markStep(db, "initial-in-person:a1", 0, "sent"); // step 0 already sent
    const out = await cancelEnrollment(db, "initial-in-person:a1");
    expect(out.cancelledSteps).toBe(1); // only the pending step 1
    expect(db._steps.find((s) => s.step_index === 0).status).toBe("sent");
    expect(db._steps.find((s) => s.step_index === 1).status).toBe("cancelled");
    expect(db._enrollments.get("initial-in-person:a1").status).toBe("cancelled");
  });
});

describe("appendEvent", () => {
  it("writes an event row with detail JSON-stringified", async () => {
    await appendEvent(db, { ts: NOW, engine: "reminder", flowKey: "initial-in-person", contactId: "c1", stepIndex: 0, action: "would_send", outcome: "would_send", channel: "email", detail: { template: "confirmation" } });
    expect(db._events).toHaveLength(1);
    expect(db._events[0]).toMatchObject({ outcome: "would_send", channel: "email" });
    expect(JSON.parse(db._events[0].detail)).toEqual({ template: "confirmation" });
  });
});
