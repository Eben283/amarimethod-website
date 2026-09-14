import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("./ghl.js", () => ({ ghlFetch: vi.fn() }));
import { ghlFetch } from "./ghl.js";
import { sendConversationMessage } from "./ghl-send.js";

afterEach(() => vi.resetAllMocks());

describe("provider JSON Unicode boundary", () => {
  it.each([
    "You're booked — here's what to expect",
    "José · Réservation confirmée · 予約確認 🙂",
    "Olá, Ângela e Ãngela",
  ])("preserves subject and HTML through UTF-8 JSON without MIME double-encoding: %s", async (subject) => {
    ghlFetch.mockResolvedValue({ ok: true, json: async () => ({ messageId: "test-only" }) });
    const html = "<p>Hi José — 予約確認 🙂</p><p>" + "é &amp; à".repeat(500) + "</p>";
    const result = await sendConversationMessage({ env: {} }, { channel: "email", contactId: "abc123", subject, html });
    expect(result.success).toBe(true);
    const bytes = new TextEncoder().encode(ghlFetch.mock.calls[0][2].body);
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    expect(payload).toEqual({ type: "Email", contactId: "abc123", subject, html });
    expect(payload.subject).not.toContain("=?UTF-8?");
  });
});
