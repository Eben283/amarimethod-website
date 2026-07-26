import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ghl.js", () => ({ ghlFetch: vi.fn() }));

import { ghlFetch } from "./ghl.js";
import {
  SEND_LIMITS,
  GHL_MESSAGE_ENDPOINT,
  validateSend,
  sendConversationMessage,
} from "./ghl-send.js";

const CTX = { env: {} };
const okRes = (body = { messageId: "m_1" }) => ({ ok: true, status: 201, json: async () => body });
const errRes = (status = 422, text = "bad phone") => ({ ok: false, status, text: async () => text });

// Built from char codes so this source stays pure ASCII (no invisible bytes in the file).
const RLO = String.fromCharCode(0x202e); // right-to-left override (bidi smuggling)
const BELL = String.fromCharCode(0x07); // a control char

beforeEach(() => {
  ghlFetch.mockReset();
});

describe("validateSend", () => {
  it("accepts a well-formed SMS and email", () => {
    expect(validateSend({ channel: "sms", contactId: "abc123", message: "hi" })).toEqual({ ok: true });
    expect(validateSend({ channel: "email", contactId: "abc123", subject: "s", html: "<p>b</p>" })).toEqual({ ok: true });
  });

  it("rejects an unknown channel", () => {
    expect(validateSend({ channel: "push", contactId: "abc123", message: "hi" }).ok).toBe(false);
  });

  it("rejects an invalid contactId", () => {
    expect(validateSend({ channel: "sms", contactId: "abc 123", message: "hi" }).ok).toBe(false);
    expect(validateSend({ channel: "sms", contactId: "", message: "hi" }).ok).toBe(false);
  });

  it("requires message for SMS and subject+html for email", () => {
    expect(validateSend({ channel: "sms", contactId: "abc123", message: "   " }).ok).toBe(false);
    expect(validateSend({ channel: "email", contactId: "abc123", subject: "", html: "<p>b</p>" }).ok).toBe(false);
    expect(validateSend({ channel: "email", contactId: "abc123", subject: "s", html: "" }).ok).toBe(false);
  });

  it("enforces length caps", () => {
    expect(validateSend({ channel: "sms", contactId: "abc123", message: "x".repeat(SEND_LIMITS.SMS_MAX + 1) }).ok).toBe(false);
    expect(validateSend({ channel: "email", contactId: "abc123", subject: "x".repeat(SEND_LIMITS.EMAIL_SUBJECT_MAX + 1), html: "<p>b</p>" }).ok).toBe(false);
    expect(validateSend({ channel: "email", contactId: "abc123", subject: "s", html: "x".repeat(SEND_LIMITS.EMAIL_BODY_MAX + 1) }).ok).toBe(false);
  });

  it("blocks control chars and bidi overrides but allows newlines/tabs", () => {
    expect(validateSend({ channel: "sms", contactId: "abc123", message: `hi${RLO}evil` }).ok).toBe(false);
    expect(validateSend({ channel: "sms", contactId: "abc123", message: `hi${BELL}` }).ok).toBe(false);
    expect(validateSend({ channel: "email", contactId: "abc123", subject: "ok", html: "line1\nline2\ttabbed" }).ok).toBe(true);
  });

  it("rejects non-object params", () => {
    expect(validateSend(null).ok).toBe(false);
    expect(validateSend("nope").ok).toBe(false);
  });
});

describe("sendConversationMessage", () => {
  it("posts the SMS payload to the conversations endpoint", async () => {
    ghlFetch.mockResolvedValue(okRes({ messageId: "sms_9" }));
    const out = await sendConversationMessage(CTX, { channel: "sms", contactId: "abc123", message: "see you at 3" });

    expect(out).toEqual({ success: true, channel: "sms", contactId: "abc123", messageId: "sms_9" });
    expect(ghlFetch).toHaveBeenCalledTimes(1);
    const [ctxArg, url, opts] = ghlFetch.mock.calls[0];
    expect(ctxArg).toBe(CTX);
    expect(url).toBe(GHL_MESSAGE_ENDPOINT);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ type: "SMS", contactId: "abc123", message: "see you at 3" });
  });

  it("posts the Email payload with subject + html", async () => {
    ghlFetch.mockResolvedValue(okRes({ id: "email_7" }));
    const out = await sendConversationMessage(CTX, { channel: "email", contactId: "abc123", subject: "Booked", html: "<p>hi</p>" });

    expect(out.success).toBe(true);
    expect(out.messageId).toBe("email_7");
    expect(JSON.parse(ghlFetch.mock.calls[0][2].body)).toEqual({ type: "Email", contactId: "abc123", subject: "Booked", html: "<p>hi</p>" });
  });

  it("does not call GHL when validation fails", async () => {
    const out = await sendConversationMessage(CTX, { channel: "sms", contactId: "abc123", message: "" });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/required/);
    expect(ghlFetch).not.toHaveBeenCalled();
  });

  it("returns a typed failure on GHL rejection (no throw)", async () => {
    ghlFetch.mockResolvedValue(errRes(422, "invalid phone"));
    const out = await sendConversationMessage(CTX, { channel: "sms", contactId: "abc123", message: "hi" });
    expect(out.success).toBe(false);
    expect(out.status).toBe(422);
    expect(out.error).toContain("422");
    expect(out.error).toContain("invalid phone");
  });

  it("returns a typed failure when ghlFetch throws (no throw)", async () => {
    ghlFetch.mockRejectedValue(new Error("network down"));
    const out = await sendConversationMessage(CTX, { channel: "sms", contactId: "abc123", message: "hi" });
    expect(out.success).toBe(false);
    expect(out.error).toContain("network down");
  });

  it("succeeds even when the response body has no id", async () => {
    ghlFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const out = await sendConversationMessage(CTX, { channel: "sms", contactId: "abc123", message: "hi" });
    expect(out.success).toBe(true);
    expect(out.messageId).toBe(null);
  });

  it("does not mutate the input params", async () => {
    ghlFetch.mockResolvedValue(okRes());
    const params = { channel: "sms", contactId: "abc123", message: "hi" };
    const snapshot = { ...params };
    await sendConversationMessage(CTX, params);
    expect(params).toEqual(snapshot);
  });
});
