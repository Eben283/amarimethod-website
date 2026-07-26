import { describe, it, expect, beforeEach } from "vitest";
import {
  enrollmentId, saveEnrollment, loadDueSteps, loadActiveEnrollments,
  markStep, appendEvent, exitEnrollment,
} from "./store.js";
import { enroll } from "./enroll.js";
import { FLOW_1_QUIZ } from "./config.js";
import { fakeD1 } from "./fake-d1.js";

const NOW = Date.parse("2026-07-12T10:00:00-07:00");
const DAY = 86400000;
const quizEvent = { kind: "quiz.submitted", contactId: "cont_1" };

let db;
beforeEach(() => { db = fakeD1(); });

const freshEnrollment = () => enroll(quizEvent, FLOW_1_QUIZ, { tags: [] }, NOW);

describe("enrollmentId", () => {
  it("is one enrollment per (sequence, contact)", () => {
    expect(enrollmentId("flow-1-quiz", "cont_1")).toBe("flow-1-quiz:cont_1");
  });
});

describe("saveEnrollment", () => {
  it("persists the enrollment + its steps", async () => {
    const { created } = await saveEnrollment(db, freshEnrollment());
    expect(created).toBe(true);
    expect(db._enrollments.size).toBe(1);
    expect(db._steps).toHaveLength(6);
  });

  it("is idempotent — a duplicate quiz.submitted never double-enrolls (brief RED test b)", async () => {
    await saveEnrollment(db, freshEnrollment());
    const { created } = await saveEnrollment(db, freshEnrollment());
    expect(created).toBe(false);
    expect(db._steps).toHaveLength(6);
  });
});

describe("loadDueSteps", () => {
  it("returns only pending steps whose time has come, on active enrollments, oldest first", async () => {
    await saveEnrollment(db, freshEnrollment());
    expect(await loadDueSteps(db, NOW)).toHaveLength(1); // step 0 (0d) due now
    const due = await loadDueSteps(db, NOW + 3 * DAY);
    expect(due).toHaveLength(2);
    expect(due[0].step.stepIndex).toBe(0);
    expect(due[1].step.stepIndex).toBe(1);
    expect(due[0].enrollment.sequenceId).toBe("flow-1-quiz");
  });

  it("marked steps leave the due-queue", async () => {
    await saveEnrollment(db, freshEnrollment());
    await markStep(db, enrollmentId("flow-1-quiz", "cont_1"), 0, "would_send");
    expect(await loadDueSteps(db, NOW)).toHaveLength(0);
  });
});

describe("exitEnrollment — the first-class exit", () => {
  it("marks pending steps exited and closes the enrollment; history statuses stay", async () => {
    await saveEnrollment(db, freshEnrollment());
    await markStep(db, enrollmentId("flow-1-quiz", "cont_1"), 0, "would_send"); // already happened
    const { exitedSteps, closed } = await exitEnrollment(db, enrollmentId("flow-1-quiz", "cont_1"));
    expect(exitedSteps).toBe(5);
    expect(closed).toBe(true);
    expect(db._steps.filter((s) => s.status === "exited")).toHaveLength(5);
    expect(db._steps.filter((s) => s.status === "would_send")).toHaveLength(1);
    expect(db._enrollments.get("flow-1-quiz:cont_1").status).toBe("exited");
    // nothing left to fire, ever
    expect(await loadDueSteps(db, NOW + 365 * DAY)).toHaveLength(0);
  });

  it("is a no-op on a contact with no enrollment (brief RED test e — no error, no ghost state)", async () => {
    const { exitedSteps, closed } = await exitEnrollment(db, enrollmentId("flow-1-quiz", "nobody"));
    expect(exitedSteps).toBe(0);
    expect(closed).toBe(false);
    expect(db._enrollments.size).toBe(0);
  });
});

describe("loadActiveEnrollments", () => {
  it("lists a contact's active enrollments (what the exit pass scans)", async () => {
    await saveEnrollment(db, freshEnrollment());
    const active = await loadActiveEnrollments(db, "cont_1");
    expect(active).toEqual([{ enrollmentId: "flow-1-quiz:cont_1", sequenceId: "flow-1-quiz", contactId: "cont_1" }]);
    await exitEnrollment(db, "flow-1-quiz:cont_1");
    expect(await loadActiveEnrollments(db, "cont_1")).toHaveLength(0);
  });
});

describe("appendEvent", () => {
  it("appends to automation_events with engine defaulting to nurture and JSON detail", async () => {
    await appendEvent(db, { ts: NOW, flowKey: "flow-1-quiz", contactId: "cont_1", action: "enrolled", outcome: "enrolled", detail: { mode: "shadow" } });
    expect(db._events).toHaveLength(1);
    expect(db._events[0].engine).toBe("nurture");
    expect(JSON.parse(db._events[0].detail)).toEqual({ mode: "shadow" });
  });
});
