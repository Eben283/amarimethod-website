import { describe, it, expect, vi, beforeEach } from "vitest";
import { processStep, channelForType } from "./sweep.js";

const NOW = Date.parse("2026-07-20T14:00:00-07:00");

const enrollment = () => ({ flowKey: "initial-in-person", appointmentId: "appt_1", contactId: "cont_1" });
const step = (over = {}) => ({ stepIndex: 3, at: "start-60m", type: "sms", template: "one-hour-sms", dueAt: NOW, status: "pending", ...over });

function deps(over = {}) {
  return {
    logEvent: vi.fn().mockResolvedValue(undefined),
    markStep: vi.fn().mockResolvedValue(undefined),
    renderMessage: vi.fn().mockResolvedValue({ channel: "sms", contactId: "cont_1", message: "reminder" }),
    send: vi.fn().mockResolvedValue({ success: true, messageId: "m_1" }),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("channelForType", () => {
  it("maps sms + internal_sms to sms, everything else to email", () => {
    expect(channelForType("sms")).toBe("sms");
    expect(channelForType("internal_sms")).toBe("sms");
    expect(channelForType("email")).toBe("email");
    expect(channelForType("internal_email")).toBe("email");
  });
});

describe("processStep — shadow mode (the beside-GHL safety guarantee)", () => {
  const shadowFlow = { flowKey: "initial-in-person", mode: "shadow" };

  it("NEVER calls send; logs would_send and marks the step", async () => {
    const d = deps();
    const out = await processStep({ enrollment: enrollment(), step: step(), flow: shadowFlow }, d, NOW);
    expect(out.outcome).toBe("would_send");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.renderMessage).not.toHaveBeenCalled();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ engine: "reminder", outcome: "would_send", stepIndex: 3, channel: "sms" }));
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 3, "would_send");
  });

  it("can use only an explicit handled test-delivery dependency, and records it as test-only", async () => {
    const d = deps({ controlledDelivery: vi.fn().mockResolvedValue({ handled: true, kind: "test", recipient: "test@amarimethod.com", result: { success: true, messageId: "gmail_1" } }) });
    const out = await processStep({ enrollment: enrollment(), step: step({ type: "email", template: "confirmation" }), flow: shadowFlow }, d, NOW);
    expect(out.outcome).toBe("sent");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "test_send", outcome: "sent", message_ref: "gmail_1", detail: expect.objectContaining({ testOnly: true }) }));
  });

  it("records an enabled owned cutover as a normal send, never as test-only", async () => {
    const d = deps({ controlledDelivery: vi.fn().mockResolvedValue({ handled: true, kind: "cutover", recipient: "client@amarimethod.com", result: { success: true, messageId: "gmail_2" } }) });
    const out = await processStep({ enrollment: enrollment(), step: step({ type: "email", template: "confirmation" }), flow: shadowFlow }, d, NOW);
    expect(out.outcome).toBe("sent");
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "send", detail: expect.objectContaining({ cutover: true, recipient: "client@amarimethod.com" }) }));
    expect(d.logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ testOnly: true }) }));
  });

  it("defaults to shadow when mode is unset (a new flow never sends by accident)", async () => {
    const d = deps();
    const out = await processStep({ enrollment: enrollment(), step: step(), flow: { flowKey: "x" } }, d, NOW);
    expect(out.outcome).toBe("would_send");
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe("processStep — active mode", () => {
  const activeFlow = { flowKey: "initial-in-person", mode: "active" };

  it("renders + sends once and logs sent on success", async () => {
    const d = deps();
    const out = await processStep({ enrollment: enrollment(), step: step(), flow: activeFlow }, d, NOW);
    expect(out.outcome).toBe("sent");
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "sent", message_ref: "m_1" }));
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 3, "sent");
  });

  it("logs failed (and does not throw) when the send adapter reports failure", async () => {
    const d = deps({ send: vi.fn().mockResolvedValue({ success: false, error: "invalid phone" }) });
    const out = await processStep({ enrollment: enrollment(), step: step(), flow: activeFlow }, d, NOW);
    expect(out.outcome).toBe("failed");
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", detail: { error: "invalid phone" } }));
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 3, "failed");
  });
});

describe("processStep — guards", () => {
  it("does nothing for a non-pending step", async () => {
    const d = deps();
    for (const status of ["sent", "skipped", "cancelled", "would_send"]) {
      const out = await processStep({ enrollment: enrollment(), step: step({ status }), flow: { mode: "active" } }, d, NOW);
      expect(out.outcome).toBe("skip");
    }
    expect(d.send).not.toHaveBeenCalled();
    expect(d.logEvent).not.toHaveBeenCalled();
  });
});

describe("processStep — active-mode render failures (spec-05 regression)", () => {
  const activeFlow = { flowKey: "initial-in-person", mode: "active" };

  it("a THROWING renderMessage fails the step and never escapes (one bad template must not kill the sweep)", async () => {
    const d = deps({ renderMessage: vi.fn().mockRejectedValue(new Error("template not built: one-hour-sms")) });
    const out = await processStep({ enrollment: enrollment(), step: step(), flow: activeFlow }, d, NOW);
    expect(out.outcome).toBe("failed");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markStep).toHaveBeenCalledWith(expect.anything(), 3, "failed");
  });

  it("a THROWING send is contained the same way", async () => {
    const d = deps({ send: vi.fn().mockRejectedValue(new Error("network")) });
    const out = await processStep({ enrollment: enrollment(), step: step(), flow: activeFlow }, d, NOW);
    expect(out.outcome).toBe("failed");
  });
});
