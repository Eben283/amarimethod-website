import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ghl-send.js", () => ({
  sendConversationMessage: vi.fn(async ({ channel }) => ({
    success: true,
    channel,
    messageId: "m1",
  })),
}));

import { buildFlipCopy, notifyOpsFlip } from "./ops-notify.js";
import { sendConversationMessage } from "./ghl-send.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildFlipCopy", () => {
  it("names the person and path in SMS", () => {
    const copy = buildFlipCopy({
      id: "inc_1",
      pathId: "assessment_paid_book",
      title: "Paid Assessment, no appointment",
      personLabel: "Holly Brinkman",
      failedHopId: "create_appointment",
    });
    expect(copy.sms).toContain("Holly Brinkman");
    expect(copy.sms).toContain("Paid Assessment, no appointment");
    expect(copy.sms).toContain("/ops#path/assessment_paid_book");
    expect(copy.subject).toContain("Paid Assessment, no appointment");
    expect(copy.html).toContain("/ops#path/assessment_paid_book");
  });
});


describe("notifyOpsFlip", () => {
  it("money severity → SMS + email to OPS_ALERT_CONTACT_ID", async () => {
    const ctx = { env: { OPS_ALERT_CONTACT_ID: "ebenContact" } };
    const res = await notifyOpsFlip(ctx, {
      id: "inc_1",
      severity: "money",
      title: "Paid Assessment, no appointment",
      pathId: "assessment_paid_book",
    });
    expect(res.sent).toBe(true);
    expect(sendConversationMessage).toHaveBeenCalledTimes(2);
    expect(sendConversationMessage).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ channel: "sms", contactId: "ebenContact" }),
    );
    expect(sendConversationMessage).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ channel: "email", contactId: "ebenContact" }),
    );
  });

  it("infra → no text/email", async () => {
    const res = await notifyOpsFlip(
      { env: { OPS_ALERT_CONTACT_ID: "ebenContact" } },
      { severity: "infra", title: "token" },
    );
    expect(res.reason).toBe("infra-app-only");
    expect(sendConversationMessage).not.toHaveBeenCalled();
  });

  it("missing OPS_ALERT_CONTACT_ID falls back to Eben default contact", async () => {
    const { DEFAULT_OPS_ALERT_CONTACT_ID } = await import("./ops-notify.js");
    const res = await notifyOpsFlip({ env: {} }, { severity: "money", title: "x", pathId: "p" });
    expect(res.sent).toBe(true);
    expect(sendConversationMessage).toHaveBeenCalled();
    expect(sendConversationMessage.mock.calls[0][1].contactId).toBe(DEFAULT_OPS_ALERT_CONTACT_ID);
  });

  it("OPS_ALERT_MODE=shadow does not send", async () => {
    const res = await notifyOpsFlip(
      { env: { OPS_ALERT_CONTACT_ID: "ebenContact", OPS_ALERT_MODE: "shadow" } },
      { severity: "money", title: "x" },
    );
    expect(res.shadowed).toBe(true);
    expect(sendConversationMessage).not.toHaveBeenCalled();
  });
});
