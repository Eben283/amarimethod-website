import { describe, expect, it, vi } from "vitest";

import { deliverNurtureEmail, nurtureEmailDeliveryReadiness } from "./email-delivery.js";

const released = {
  NURTURE_EMAIL_DELIVERY_RELEASE: "approved",
  NURTURE_EMAIL_SEQUENCE_ALLOWLIST: JSON.stringify(["flow-1-quiz"]),
};
const message = {
  sequenceId: "flow-1-quiz",
  deliveryKey: "flow-1-quiz:contact-1:v2:s0",
  recipient: { contactId: "contact-1", email: "lead@example.test" },
  subject: "A subject",
  preheader: "A preview",
  body: "Exact body",
};

describe("owned nurture email delivery boundary", () => {
  it("requires both the exact release value and a valid known-sequence allowlist", () => {
    expect(nurtureEmailDeliveryReadiness({}, "flow-1-quiz").enabled).toBe(false);
    expect(nurtureEmailDeliveryReadiness({ ...released, NURTURE_EMAIL_DELIVERY_RELEASE: "true" }, "flow-1-quiz").enabled).toBe(false);
    expect(nurtureEmailDeliveryReadiness({ ...released, NURTURE_EMAIL_SEQUENCE_ALLOWLIST: "*" }, "flow-1-quiz").enabled).toBe(false);
    expect(nurtureEmailDeliveryReadiness({ ...released, NURTURE_EMAIL_SEQUENCE_ALLOWLIST: '["unknown"]' }, "flow-1-quiz").enabled).toBe(false);
    expect(nurtureEmailDeliveryReadiness(released, "flow-1-quiz")).toEqual(expect.objectContaining({
      enabled: true,
      senderActor: "Garrett",
      receiptState: "provider_submission_only",
      terminalDeliveryEvidence: false,
    }));
  });

  it("does not call the provider while either release gate is closed", async () => {
    const sendGmailEmail = vi.fn();
    await expect(deliverNurtureEmail({}, message, { sendGmailEmail })).resolves.toEqual(expect.objectContaining({
      success: false, code: "delivery_not_released",
    }));
    expect(sendGmailEmail).not.toHaveBeenCalled();
  });

  it("uses the server-owned Garrett identity and reports submission, never terminal delivery", async () => {
    const sendGmailEmail = vi.fn().mockResolvedValue({ id: "gmail-message-1", threadId: "thread-1" });
    const recordSubmission = vi.fn().mockResolvedValue({ submissionId: "submission-1" });
    await expect(deliverNurtureEmail(released, message, { sendGmailEmail, recordSubmission })).resolves.toEqual({
      success: true,
      messageId: "gmail-message-1",
      provider: "google-workspace",
      receiptState: "submitted",
      terminal: false,
    });
    expect(sendGmailEmail).toHaveBeenCalledWith(released, {
      actor: "Garrett",
      to: "lead@example.test",
      subject: "A subject",
      preheader: "A preview",
      text: "Exact body",
    });
    expect(recordSubmission).toHaveBeenCalledWith(undefined, expect.objectContaining({
      mailboxActor: "Garrett",
      grantOwner: "garrett@amarimethod.com",
      submissionRef: message.deliveryKey,
      contactId: "contact-1",
      providerMessageId: "gmail-message-1",
      gmailThreadId: "thread-1",
    }));
  });

  it("never retries or calls a provider-accepted message failed when evidence storage breaks", async () => {
    const result = await deliverNurtureEmail(released, message, {
      sendGmailEmail: vi.fn().mockResolvedValue({ id: "gmail-message-1" }),
      recordSubmission: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      messageId: "gmail-message-1",
      receiptState: "submission_unreconciled",
      evidenceError: "D1 unavailable",
      terminal: false,
    }));
  });

  it("rejects a malformed stable delivery key before provider access", async () => {
    const sendGmailEmail = vi.fn();
    const result = await deliverNurtureEmail(released, { ...message, deliveryKey: "anything" }, { sendGmailEmail });
    expect(result).toEqual(expect.objectContaining({ success: false, code: "invalid_delivery_key" }));
    expect(sendGmailEmail).not.toHaveBeenCalled();
  });

  it("normalizes provider failure without claiming a send or delivery", async () => {
    const sendGmailEmail = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { retryable: true }));
    await expect(deliverNurtureEmail(released, message, { sendGmailEmail })).resolves.toEqual(expect.objectContaining({
      success: false,
      code: "provider_submission_failed",
      error: "rate limited",
      retryable: true,
    }));
  });
});
