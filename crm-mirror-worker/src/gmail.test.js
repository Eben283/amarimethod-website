import { afterEach, describe, expect, it, vi } from "vitest";
import { getGoogleWorkspaceToken, listGmailSenders, sendGmailEmail } from "./gmail.js";

function env(values = {}) {
  const store = new Map(Object.entries(values));
  return { GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret", PORTAL_KV: { get: vi.fn(async (key) => store.get(key) || null), put: vi.fn(async (key, value) => store.set(key, value)) } };
}
afterEach(() => vi.unstubAllGlobals());

describe("Gmail provider", () => {
  it("uses a current stored token without refreshing it", async () => {
    const e = env({ "google:eben:access_token": "current-token", "google:eben:token_expiry": String(Date.now() + 600_000) });
    await expect(getGoogleWorkspaceToken(e)).resolves.toBe("current-token");
  });

  it("sends a text email through Gmail without exposing the token in the payload", async () => {
    const e = env({ "google:eben:access_token": "current-token", "google:eben:token_expiry": String(Date.now() + 600_000) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "gmail-id", threadId: "thread-id" }), { status: 200 })));
    await expect(sendGmailEmail(e, { to: "person@example.test", from: "eben@amarimethod.com", senders: [{ address: "eben@amarimethod.com" }], subject: "A subject", text: "Private body" })).resolves.toEqual({ id: "gmail-id", threadId: "thread-id" });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toContain("gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(request.headers.Authorization).toBe("Bearer current-token");
    expect(request.body).not.toContain("current-token");
    expect(JSON.parse(request.body).raw).toBeTruthy();
    const decoded = Buffer.from(JSON.parse(request.body).raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: eben@amarimethod.com");
  });

  it("lists only Gmail-authorized primary or accepted send-as identities", async () => {
    const e = env({ "google:eben:access_token": "current-token", "google:eben:token_expiry": String(Date.now() + 600_000) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sendAs: [
      { sendAsEmail: "eben@amarimethod.com", displayName: "Eben", verificationStatus: "accepted", isDefault: true },
      { sendAsEmail: "pending@amarimethod.com", verificationStatus: "pending" },
      { sendAsEmail: "primary@amarimethod.com", isPrimary: true },
    ] }), { status: 200 })));
    await expect(listGmailSenders(e)).resolves.toEqual([
      { address: "eben@amarimethod.com", name: "Eben", isDefault: true, isPrimary: false },
      { address: "primary@amarimethod.com", name: "", isDefault: false, isPrimary: true },
    ]);
  });
});
