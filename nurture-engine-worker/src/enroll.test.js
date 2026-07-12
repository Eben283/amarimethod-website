import { describe, it, expect } from "vitest";
import { parseAfter, enroll, importEnrollment } from "./enroll.js";
import { FLOW_1_QUIZ, FLOW_2_POST_DISCOVERY, FLOW_3_POST_INITIAL } from "./config.js";

const NOW = Date.parse("2026-07-12T10:00:00-07:00");
const DAY = 86400000;

const quizEvent = { kind: "quiz.submitted", contactId: "cont_1" };
const showedInitial = {
  kind: "appointment", type: "showed", calendarId: "G7OAnnJuFbMF6nQSlZVQ",
  contactId: "cont_1", appointmentId: "appt_1", modifiedBy: "user",
};

describe("parseAfter", () => {
  it("parses day and hour offsets to ms", () => {
    expect(parseAfter("0d")).toBe(0);
    expect(parseAfter("+3d")).toBe(3 * DAY);
    expect(parseAfter("+12h")).toBe(12 * 3600000);
  });

  it("throws on junk (a typo'd config must fail loudly, not schedule garbage)", () => {
    expect(() => parseAfter("3 days")).toThrow();
    expect(() => parseAfter("-1d")).toThrow();
  });
});

describe("enroll — scheduling is keyed off ENROLLMENT time, offsets cumulative", () => {
  it("resolves each step's dueAt as the running sum of `after` offsets from now", () => {
    const e = enroll(showedInitial, FLOW_3_POST_INITIAL, { tags: [] }, NOW);
    expect(e.sequenceId).toBe("flow-3-post-initial");
    expect(e.contactId).toBe("cont_1");
    expect(e.enteredAt).toBe(NOW);
    expect(e.status).toBe("active");
    expect(e.steps.map((s) => s.dueAt)).toEqual([NOW, NOW + 5 * DAY, NOW + 10 * DAY]);
    expect(e.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("email steps carry their template; branch steps carry none (resolved fresh at send time)", () => {
    const e = enroll(quizEvent, FLOW_1_QUIZ, { tags: [] }, NOW);
    expect(e.steps[0].template).toBe("f1-email-1-quiz-results");
    expect(e.steps[1].template).toBeNull(); // branch
    expect(e.steps[3].template).toBeNull(); // branch_map
    expect(e.steps.map((s) => s.dueAt)).toEqual([
      NOW, NOW + 3 * DAY, NOW + 7 * DAY, NOW + 10 * DAY, NOW + 18 * DAY, NOW + 28 * DAY,
    ]);
  });

  it("does not mutate the event or the config", () => {
    const evCopy = { ...showedInitial };
    enroll(showedInitial, FLOW_3_POST_INITIAL, { tags: [] }, NOW);
    expect(showedInitial).toEqual(evCopy);
    expect(Object.isFrozen(FLOW_3_POST_INITIAL)).toBe(true);
  });
});

describe("enroll — entry guard", () => {
  it("a guard tag on the contact blocks enrollment (ambassador-prospect never enters Flow 2)", () => {
    const showedDiscovery = { ...showedInitial, calendarId: "USgPsktqRcuomdUgpShL" };
    expect(enroll(showedDiscovery, FLOW_2_POST_DISCOVERY, { tags: ["ambassador-prospect"] }, NOW)).toBeNull();
    expect(enroll(showedInitial, FLOW_3_POST_INITIAL, { tags: ["affiliate-partner"] }, NOW)).toBeNull();
  });

  it("guard tags are matched case-insensitively (GHL tag casing is unreliable)", () => {
    expect(enroll(showedInitial, FLOW_3_POST_INITIAL, { tags: ["Affiliate-Partner"] }, NOW)).toBeNull();
  });

  it("UNKNOWN tags in shadow mode: enrolls optimistically, flagged guardUnchecked", () => {
    const e = enroll(showedInitial, FLOW_3_POST_INITIAL, { tags: null }, NOW);
    expect(e).not.toBeNull();
    expect(e.guardUnchecked).toBe(true);
  });

  it("UNKNOWN tags in ACTIVE mode: fails closed (never emails someone the guard might exclude)", () => {
    const active = { ...FLOW_3_POST_INITIAL, mode: "active" };
    expect(enroll(showedInitial, active, { tags: null }, NOW)).toBeNull();
  });

  it("a sequence with no guard enrolls fine with unknown tags, unflagged", () => {
    const e = enroll(quizEvent, FLOW_1_QUIZ, { tags: null }, NOW);
    expect(e).not.toBeNull();
    expect(e.guardUnchecked).toBe(false);
  });
});

describe("importEnrollment — mid-sequence cutover (15 in-flight in Flow 1, 1 in Flow 3)", () => {
  it("computes dueAt from the ORIGINAL entry time and never back-fires already-due steps", () => {
    const enteredAt = NOW - 8 * DAY; // entered 8 days ago: emails 1 (+0d), 2 (+3d), 3 (+7d) already handled by GHL
    const e = importEnrollment(FLOW_1_QUIZ, { contactId: "cont_9", enteredAt }, NOW);
    expect(e.enteredAt).toBe(enteredAt);
    expect(e.status).toBe("active");
    expect(e.steps.map((s) => s.status)).toEqual([
      "imported", "imported", "imported", "pending", "pending", "pending",
    ]);
    expect(e.steps[3].dueAt).toBe(enteredAt + 10 * DAY); // day 10, in 2 days — engine takes over here
  });

  it("a fully-elapsed sequence imports with every step marked imported (nothing to fire)", () => {
    const e = importEnrollment(FLOW_1_QUIZ, { contactId: "cont_9", enteredAt: NOW - 40 * DAY }, NOW);
    expect(e.steps.every((s) => s.status === "imported")).toBe(true);
  });
});
