import { afterEach, describe, expect, it, vi } from "vitest";
import { getGoogleWorkspaceToken, sendGmailEmail } from "./gmail.js";

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
    await expect(sendGmailEmail(e, { to: "person@example.test", subject: "A subject", text: "Private body" })).resolves.toEqual({ id: "gmail-id", threadId: "thread-id" });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toContain("gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(request.headers.Authorization).toBe("Bearer current-token");
    expect(request.body).not.toContain("current-token");
    expect(JSON.parse(request.body).raw).toBeTruthy();
  });
});
