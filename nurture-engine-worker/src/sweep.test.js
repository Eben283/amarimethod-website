import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTemplate, processStep } from "./sweep.js";
import { FLOW_1_QUIZ, FLOW_3_POST_INITIAL } from "./config.js";

const NOW = Date.parse("2026-07-15T10:00:00-07:00");

const enrollment = () => ({ sequenceId: "flow-1-quiz", definitionVersion: 1, contactId: "cont_1" });
const emailStep = { stepIndex: 0, after: "0d", kind: "email", template: "f1-email-1-quiz-results", dueAt: NOW, status: "pending" };
const branchStep = { stepIndex: 1, after: "+3d", kind: "branch", template: null, dueAt: NOW, status: "pending" };

function deps(over = {}) {
  return {
    logEvent: vi.fn().mockResolvedValue(undefined),
    markStep: vi.fn().mockResolvedValue(undefined),
    claimStep: vi.fn().mockResolvedValue(true),
    getContactFields: vi.fn().mockResolvedValue({ primaryPainLocation: "Hips" }),
    renderMessage: vi.fn().mockResolvedValue({ channel: "email", contactId: "cont_1", subject: "s", html: "<p>b</p>" }),
    send: vi.fn().mockResolvedValue({ success: true, messageId: "m_1" }),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveTemplate — branch semantics against contact fields", () => {
  const branchDef = FLOW_1_QUIZ.steps[1]; // filled_not_other on primary_pain_location
  const mapDef = FLOW_1_QUIZ.steps[3]; // 5-way branch_map

  it("email steps resolve to their own template", () => {
    expect(resolveTemplate(FLOW_1_QUIZ.steps[0], null)).toBe("f1-email-1-quiz-results");
  });

  it("filled_not_other: filled and not Other → yes; empty or Other → no (the chronic fallback)", () => {
    expect(resolveTemplate(branchDef, { primaryPainLocation: "Hips" })).toBe("f1-email-2");
    expect(resolveTemplate(branchDef, { primaryPainLocation: "Other" })).toBe("f1-email-2-chronic");
    expect(resolveTemplate(branchDef, { primaryPainLocation: "" })).toBe("f1-email-2-chronic");
    expect(resolveTemplate(branchDef, {})).toBe("f1-email-2-chronic");
  });

  it("branch_map: maps the field value, falls to default for unknown values", () => {
    expect(resolveTemplate(mapDef, { primaryPainLocation: "Lower back" })).toBe("f1-email-4a-spinal-wave");
    expect(resolveTemplate(mapDef, { primaryPainLocation: "Elbows" })).toBe("f1-email-4d-hand-balancer");
    expect(resolveTemplate(mapDef, { primaryPainLocation: "somewhere else" })).toBe("f1-email-4c-chronic");
  });

  it("branch with UNKNOWN fields (null) resolves to null — the caller decides what that means", () => {
    expect(resolveTemplate(branchDef, null)).toBeNull();
  });
});

describe("processStep — shadow mode (the beside-GHL safety guarantee)", () => {
  it("retires a queued step removed by a newer immutable definition without rendering or sending", async () => {
    const d = deps();
    const oldStep = { status: "pending", stepIndex: 2, dueAt: NOW };
    const out = await processStep({ enrollment: enrollment(), step: oldStep, sequence: FLOW_3_POST_INITIAL }, d, NOW);
    expect(out).toEqual({ outcome: "skip", reason: "definition_step_retired" });
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "definition_step_retired",
      outcome: "retired",
      detail: { enrollmentDefinitionVersion: 1, currentDefinitionVersion: 2 },
    }));
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 2, "retired");
    expect(d.renderMessage).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  const shadowSeq = FLOW_1_QUIZ; // mode: "shadow"

  it("NEVER sends, NEVER reads the contact; logs would_send and marks the step", async () => {
    const d = deps();
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: shadowSeq }, d, NOW);
    expect(out.outcome).toBe("would_send");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.renderMessage).not.toHaveBeenCalled();
    expect(d.getContactFields).not.toHaveBeenCalled();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      engine: "nurture", flowKey: "flow-1-quiz", outcome: "would_send", channel: "email",
      detail: expect.objectContaining({ template: "f1-email-1-quiz-results" }),
    }));
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 0, "would_send");
  });

  it("a due BRANCH step in shadow logs its candidate templates without resolving (zero GHL reads)", async () => {
    const d = deps();
    const out = await processStep({ enrollment: enrollment(), step: branchStep, sequence: shadowSeq }, d, NOW);
    expect(out.outcome).toBe("would_send");
    expect(d.getContactFields).not.toHaveBeenCalled();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ template: null, branch: "primaryPainLocation", variants: ["f1-email-2", "f1-email-2-chronic"] }),
    }));
  });

  it("defaults to shadow when mode is unset (a new sequence never sends by accident)", async () => {
    const d = deps();
    const seq = { ...FLOW_1_QUIZ, mode: undefined };
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: seq }, d, NOW);
    expect(out.outcome).toBe("would_send");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("skips non-pending steps", async () => {
    const d = deps();
    const out = await processStep({ enrollment: enrollment(), step: { ...emailStep, status: "exited" }, sequence: shadowSeq }, d, NOW);
    expect(out).toEqual({ outcome: "skip", reason: "exited" });
    expect(d.logEvent).not.toHaveBeenCalled();
  });
});

describe("processStep — active mode", () => {
  const activeSeq = { ...FLOW_1_QUIZ, mode: "active" };

  it("sends an email step once and logs sent", async () => {
    const d = deps();
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: activeSeq }, d, NOW);
    expect(out.outcome).toBe("sent");
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "sent", message_ref: "m_1" }));
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 0, "sent");
    expect(d.claimStep).toHaveBeenCalledWith(expect.anything(), 0);
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "dispatch_started", outcome: "dispatching" }));
  });

  it("records a Gmail acceptance as submitted, not terminally delivered", async () => {
    const d = deps({ send: vi.fn().mockResolvedValue({
      success: true, messageId: "gmail-1", provider: "google-workspace", receiptState: "submitted", terminal: false,
    }) });
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: activeSeq }, d, NOW);
    expect(out.outcome).toBe("submitted");
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "submitted",
      message_ref: "gmail-1",
      detail: expect.objectContaining({ receiptState: "submitted", terminal: false }),
    }));
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 0, "submitted");
  });

  it("preserves an accepted-but-unreconciled submission as a non-retryable exception", async () => {
    const d = deps({ send: vi.fn().mockResolvedValue({
      success: true,
      messageId: "gmail-1",
      provider: "google-workspace",
      receiptState: "submission_unreconciled",
      terminal: false,
      evidenceError: "D1 unavailable",
    }) });
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: activeSeq }, d, NOW);
    expect(out.outcome).toBe("submission_unreconciled");
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 0, "submission_unreconciled");
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "submission_unreconciled",
      detail: expect.objectContaining({ evidenceError: "D1 unavailable" }),
    }));
  });

  it("does not send when another sweep wins the atomic dispatch claim", async () => {
    const d = deps({ claimStep: vi.fn().mockResolvedValue(false) });
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: activeSeq }, d, NOW);
    expect(out).toEqual({ outcome: "skip", reason: "dispatch_claim_lost" });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markStep).not.toHaveBeenCalled();
  });

  it("resolves a branch against a FRESH contact read at send time (brief RED test c)", async () => {
    const d = deps({ getContactFields: vi.fn().mockResolvedValue({ primaryPainLocation: "Other" }) });
    await processStep({ enrollment: enrollment(), step: branchStep, sequence: activeSeq }, d, NOW);
    expect(d.getContactFields).toHaveBeenCalledWith("cont_1");
    expect(d.renderMessage).toHaveBeenCalledWith(activeSeq, expect.anything(), expect.anything(), "f1-email-2-chronic");
  });

  it("a failed contact read on a branch step fails the step — never guesses a variant", async () => {
    const d = deps({ getContactFields: vi.fn().mockRejectedValue(new Error("ghl 500")) });
    const out = await processStep({ enrollment: enrollment(), step: branchStep, sequence: activeSeq }, d, NOW);
    expect(out.outcome).toBe("failed");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 1, "failed");
  });

  it("a THROWING renderMessage fails the step and never escapes (one bad template must not kill the sweep)", async () => {
    const d = deps({ renderMessage: vi.fn().mockRejectedValue(new Error("template not built: f1-email-1-quiz-results")) });
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: activeSeq }, d, NOW);
    expect(out.outcome).toBe("failed");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 0, "failed");
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", detail: expect.objectContaining({ error: expect.stringContaining("template not built") }) }));
  });

  it("a send failure logs failed and never throws", async () => {
    const d = deps({ send: vi.fn().mockResolvedValue({ success: false, error: "rate limited" }) });
    const out = await processStep({ enrollment: enrollment(), step: emailStep, sequence: activeSeq }, d, NOW);
    expect(out.outcome).toBe("failed");
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", detail: expect.objectContaining({ error: "rate limited" }) }));
  });
});
