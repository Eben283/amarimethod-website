import { describe, it, expect, vi, beforeEach } from "vitest";

// Shadow sequences never send, but engine.js imports the adapter for active mode — mock it and
// assert it is NEVER called while the default-shadow sequences run.
vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));

import { handleEvent, runSweep } from "./engine.js";
import { loadDueSteps } from "./store.js";
import { sendConversationMessage } from "../../functions/lib/ghl-send.js";
import { fakeD1 } from "./fake-d1.js";

const NOW = Date.parse("2026-07-12T10:00:00-07:00");
const DAY = 86400000;

const quiz = { kind: "quiz.submitted", contactId: "cont_1" };
const appt = (over = {}) => ({
  type: "showed", recognized: true, status: "showed",
  calendarId: "USgPsktqRcuomdUgpShL", contactId: "cont_1", appointmentId: "appt_1",
  startAt: "2026-07-12T09:00:00-07:00", modifiedBy: "user", ...over,
});

let env;
beforeEach(() => { env = { NURTURE_DB: fakeD1() }; vi.clearAllMocks(); });

describe("handleEvent — entry", () => {
  it("quiz.submitted enrolls Flow 1 with its 6 steps and logs it", async () => {
    const { actions } = await handleEvent(env, quiz, NOW);
    expect(actions).toContainEqual(expect.objectContaining({ engine: "nurture", action: "enroll", detail: expect.objectContaining({ sequenceId: "flow-1-quiz" }) }));
    expect(env.NURTURE_DB._enrollments.size).toBe(1);
    expect(env.NURTURE_DB._steps).toHaveLength(6);
    expect(env.NURTURE_DB._events.some((e) => e.action === "enrolled")).toBe(true);
  });

  it("a duplicate quiz.submitted is a single enrollment (brief RED test b)", async () => {
    await handleEvent(env, quiz, NOW);
    const { actions } = await handleEvent(env, quiz, NOW);
    expect(actions).toContainEqual(expect.objectContaining({ action: "enroll-noop" }));
    expect(env.NURTURE_DB._steps).toHaveLength(6);
    expect(env.NURTURE_DB._events.filter((e) => e.action === "enrolled")).toHaveLength(1);
  });

  it("a discovery showed enrolls Flow 2 — but an ambassador-prospect never enters (guard)", async () => {
    const deps = { getContactTags: vi.fn().mockResolvedValue(["ambassador-prospect"]) };
    const { actions } = await handleEvent(env, appt(), NOW, deps);
    expect(actions).not.toContainEqual(expect.objectContaining({ action: "enroll" }));
    expect(env.NURTURE_DB._enrollments.size).toBe(0);

    const deps2 = { getContactTags: vi.fn().mockResolvedValue(["quiz submitted"]) };
    await handleEvent(env, appt({ contactId: "cont_2", appointmentId: "appt_2" }), NOW, deps2);
    expect(env.NURTURE_DB._enrollments.has("flow-2-post-discovery:cont_2")).toBe(true);
  });

  it("with no tag reader wired, a shadow enrollment proceeds flagged guardUnchecked", async () => {
    await handleEvent(env, appt(), NOW); // default deps: tags unknown
    const enr = env.NURTURE_DB._enrollments.get("flow-2-post-discovery:cont_1");
    expect(enr).toBeDefined();
    expect(enr.guard_unchecked).toBe(1);
  });

  it("events that match nothing produce no actions and no state", async () => {
    const { actions } = await handleEvent(env, appt({ type: "cancelled" }), NOW);
    expect(actions).toHaveLength(0);
    expect(env.NURTURE_DB._enrollments.size).toBe(0);
    expect(await handleEvent(env, { junk: true }, NOW)).toEqual({ actions: [] });
  });
});

describe("handleEvent — onEnter tags (Flow 3's tag IS the exit signal for Flows 1+2)", () => {
  const showedInitial = appt({ calendarId: "G7OAnnJuFbMF6nQSlZVQ" });

  it("enrolling Flow 3 exits active Flow 1 AND Flow 2 enrollments in the same pass", async () => {
    await handleEvent(env, quiz, NOW); // Flow 1 active
    await handleEvent(env, appt(), NOW); // Flow 2 active
    const { actions } = await handleEvent(env, showedInitial, NOW + DAY);
    expect(actions).toContainEqual(expect.objectContaining({ action: "enroll", detail: expect.objectContaining({ sequenceId: "flow-3-post-initial" }) }));
    expect(env.NURTURE_DB._enrollments.get("flow-1-quiz:cont_1").status).toBe("exited");
    expect(env.NURTURE_DB._enrollments.get("flow-2-post-discovery:cont_1").status).toBe("exited");
    expect(env.NURTURE_DB._enrollments.get("flow-3-post-initial:cont_1").status).toBe("active");
    // and the exits are on the observability log
    expect(env.NURTURE_DB._events.filter((e) => e.action === "exited")).toHaveLength(2);
  });

  it("in shadow mode the GHL tag write is logged as would_tag, never performed", async () => {
    const addContactTags = vi.fn();
    const { actions } = await handleEvent(env, showedInitial, NOW, { addContactTags });
    expect(addContactTags).not.toHaveBeenCalled();
    expect(actions).toContainEqual(expect.objectContaining({ action: "would_tag" }));
    expect(env.NURTURE_DB._events.some((e) => e.action === "would_tag")).toBe(true);
  });
});

describe("handleEvent — exits (the five deleted remove-from workflows)", () => {
  it("a series purchase exits Flow 3 and the pending emails never send (brief RED test a)", async () => {
    await handleEvent(env, appt({ calendarId: "G7OAnnJuFbMF6nQSlZVQ" }), NOW);
    const { actions } = await handleEvent(env, { kind: "purchase", contactId: "cont_1", productId: "69986faa724ecd2343ebaa6e" }, NOW + DAY);
    expect(actions).toContainEqual(expect.objectContaining({ action: "exit", detail: expect.objectContaining({ sequenceId: "flow-3-post-initial" }) }));
    // Emails 2 and 3 were due at +5d/+10d — nothing ever loads again
    expect(await loadDueSteps(env.NURTURE_DB, NOW + 30 * DAY)).toHaveLength(0);
  });

  it("a NON-series purchase does not exit (brief RED test b)", async () => {
    await handleEvent(env, appt({ calendarId: "G7OAnnJuFbMF6nQSlZVQ" }), NOW);
    const { actions } = await handleEvent(env, { kind: "purchase", contactId: "cont_1", productId: "some-other-product" }, NOW + DAY);
    expect(actions).toHaveLength(0);
    expect(env.NURTURE_DB._enrollments.get("flow-3-post-initial:cont_1").status).toBe("active");
  });

  it("a purchase with no matching enrollment is a no-op (brief RED test e)", async () => {
    const { actions } = await handleEvent(env, { kind: "purchase", contactId: "stranger", productId: "69986faa724ecd2343ebaa6e" }, NOW);
    expect(actions).toHaveLength(0);
    expect(env.NURTURE_DB._events).toHaveLength(0);
  });

  it("an exit event between a step becoming due and it sending → the step never sends (brief RED test a, Flow 1)", async () => {
    await handleEvent(env, quiz, NOW);
    // Email 2 became due at +3d but no sweep has run. The contact books a discovery call:
    await handleEvent(env, appt({ type: "booked", modifiedBy: "customer" }), NOW + 3 * DAY);
    const counts = await runSweep(env, NOW + 3 * DAY);
    expect(counts.would_send).toBe(0);
    expect(sendConversationMessage).not.toHaveBeenCalled();
  });

  it("a booking on the AMBASSADOR discovery calendar also exits Flow 1 (the 2026-03-05 fix)", async () => {
    await handleEvent(env, quiz, NOW);
    await handleEvent(env, appt({ type: "booked", calendarId: "aVE54Qf4lrbYTB0zFqXy", modifiedBy: "customer" }), NOW);
    expect(env.NURTURE_DB._enrollments.get("flow-1-quiz:cont_1").status).toBe("exited");
  });

  it("an initial-session booking exits Flow 2 before the +4d email fires", async () => {
    await handleEvent(env, appt(), NOW); // Flow 2 enrolled
    await handleEvent(env, appt({ type: "booked", calendarId: "ySmht5hx4uZGEpgZrlCw", appointmentId: "appt_2", modifiedBy: "customer" }), NOW + DAY);
    expect(env.NURTURE_DB._enrollments.get("flow-2-post-discovery:cont_1").status).toBe("exited");
    expect(await loadDueSteps(env.NURTURE_DB, NOW + 10 * DAY)).toHaveLength(0);
  });

  it("a bridged workflow-2 tag event exits Flow 1 only", async () => {
    await handleEvent(env, quiz, NOW);
    await handleEvent(env, appt({ contactId: "cont_1" }), NOW); // Flow 2 also active
    await handleEvent(env, { kind: "tag.added", contactId: "cont_1", tag: "booked discovery call - workflow 2" }, NOW);
    expect(env.NURTURE_DB._enrollments.get("flow-1-quiz:cont_1").status).toBe("exited");
    expect(env.NURTURE_DB._enrollments.get("flow-2-post-discovery:cont_1").status).toBe("active");
  });
});

describe("runSweep — shadow (default)", () => {
  it("logs would_send for due steps and NEVER calls the send adapter", async () => {
    await handleEvent(env, quiz, NOW);
    const counts = await runSweep(env, NOW); // only Email 1 (0d) is due
    expect(counts.would_send).toBe(1);
    expect(counts.sent).toBe(0);
    expect(sendConversationMessage).not.toHaveBeenCalled();
    expect(await loadDueSteps(env.NURTURE_DB, NOW)).toHaveLength(0); // out of the queue
    expect(env.NURTURE_DB._events.filter((e) => e.outcome === "would_send")).toHaveLength(1);
  });

  it("a due branch step shadow-logs its variants (no contact read, no send)", async () => {
    await handleEvent(env, quiz, NOW);
    const counts = await runSweep(env, NOW + 3 * DAY); // Email 1 + the Email 2 branch
    expect(counts.would_send).toBe(2);
    const branchEvt = env.NURTURE_DB._events.find((e) => e.outcome === "would_send" && e.step_index === 1);
    expect(JSON.parse(branchEvt.detail).variants).toEqual(["f1-email-2", "f1-email-2-chronic"]);
  });
});
