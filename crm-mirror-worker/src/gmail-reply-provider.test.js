import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGmailReplyProvider, GmailReplyProviderError } from "./gmail-reply-provider.js";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.readonly",
];

function env(actor = "Eben") {
  const key = actor.toLowerCase();
  const mailbox = `${key}@amarimethod.com`;
  return {
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "amari-client",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "amari-secret",
    PORTAL_KV: {
      get: vi.fn(async (requested) => {
        if (requested === `amari-mail:${key}:grant_status`) return JSON.stringify({
          actor,
          profileEmail: mailbox,
          verifiedSendAs: [mailbox],
          scopes: REQUIRED_SCOPES,
        });
        if (requested === `amari-mail:${key}:access_token`) return "private-access-token";
        if (requested === `amari-mail:${key}:token_expiry`) return String(Date.now() + 60 * 60 * 1000);
        return null;
      }),
      put: vi.fn(),
    },
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Gmail reply provider", () => {
  it("lists bounded message-added history with decimal IDs preserved as strings and no label filter", async () => {
    const fetchImpl = vi.fn(async () => response({
      history: [{
        id: "9223372036854775700",
        messages: [{ id: "ignored-message", threadId: "ignored-thread" }],
        messagesAdded: [{ message: { id: "m-1", threadId: "t-1", labelIds: ["INBOX"] } }],
      }],
      nextPageToken: "next-page",
      historyId: "9223372036854775807",
    }));
    const provider = createGmailReplyProvider(env("Eben"), "Eben", { fetchImpl });

    await expect(provider.listHistoryPage({
      startHistoryId: "9223372036854775000",
      pageToken: "page-one",
      maxResults: 900,
    })).resolves.toEqual({
      history: [{ id: "9223372036854775700", messagesAdded: [{ message: { id: "m-1", threadId: "t-1" } }] }],
      nextPageToken: "next-page",
      historyId: "9223372036854775807",
    });

    expect(provider.mailboxContext).toEqual({ mailboxActor: "Eben", grantOwner: "eben@amarimethod.com" });
    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.isFrozen(provider.mailboxContext)).toBe(true);
    const request = new URL(fetchImpl.mock.calls[0][0]);
    expect(request.origin).toBe("https://gmail.googleapis.com");
    expect(request.pathname).toBe("/gmail/v1/users/me/history");
    expect(request.searchParams.get("startHistoryId")).toBe("9223372036854775000");
    expect(request.searchParams.get("historyTypes")).toBe("messageAdded");
    expect(request.searchParams.get("maxResults")).toBe("500");
    expect(request.searchParams.get("pageToken")).toBe("page-one");
    expect(request.searchParams.has("labelId")).toBe(false);
    expect(fetchImpl.mock.calls[0][1]).toEqual({
      method: "GET",
      headers: { Authorization: "Bearer private-access-token" },
    });
  });

  it("gets only the exact requested full message over GET", async () => {
    const message = {
      id: "message_123",
      threadId: "thread_123",
      historyId: "9007199254740993123",
      internalDate: "1786208400000",
      mailboxActor: "Eben",
      grantOwner: "eben@amarimethod.com",
      labelIds: ["INBOX"],
      payload: { headers: [{ name: "From", value: "client@example.test" }] },
    };
    const fetchImpl = vi.fn(async () => response(message));
    const provider = createGmailReplyProvider(env("Garrett"), "Garrett", { fetchImpl });

    await expect(provider.getMessage("message_123")).resolves.toEqual(message);

    // Mailbox ownership is derived from the signed actor, never a provider body.
    expect(provider.mailboxContext).toEqual({ mailboxActor: "Garrett", grantOwner: "garrett@amarimethod.com" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/message_123?format=full");
    expect(init.method).toBe("GET");
  });

  it("rejects caller identity and token fields instead of letting them alter Garrett's context", async () => {
    const fetchImpl = vi.fn();
    expect(() => createGmailReplyProvider(env("Garrett"), "Garrett", {
      fetchImpl,
      accessToken: "caller-token",
    })).toThrowError(expect.objectContaining({ code: "invalid_input" }));

    const provider = createGmailReplyProvider(env("Garrett"), "Garrett", { fetchImpl });
    await expect(provider.listHistoryPage({
      startHistoryId: "123",
      mailboxActor: "Eben",
      mailboxAddress: "eben@amarimethod.com",
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(provider.mailboxContext).toEqual({ mailboxActor: "Garrett", grantOwner: "garrett@amarimethod.com" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects numeric history IDs before JavaScript can lose decimal precision", async () => {
    const fetchImpl = vi.fn();
    const provider = createGmailReplyProvider(env(), "Eben", { fetchImpl });

    await expect(provider.listHistoryPage({ startHistoryId: 900719925474099312345 }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies an expired history cursor separately from auth and provider failures", async () => {
    const expired = createGmailReplyProvider(env(), "Eben", { fetchImpl: vi.fn(async () => response({}, 404)) });
    await expect(expired.listHistoryPage({ startHistoryId: "123" })).rejects.toMatchObject({
      name: "GmailReplyProviderError",
      code: "history_cursor_expired",
      status: 404,
      retryable: false,
    });

    const unauthorized = createGmailReplyProvider(env(), "Eben", { fetchImpl: vi.fn(async () => response({}, 401)) });
    await expect(unauthorized.listHistoryPage({ startHistoryId: "123" })).rejects.toMatchObject({
      code: "gmail_auth_failed",
      status: 401,
      retryable: false,
    });

    const unavailable = createGmailReplyProvider(env(), "Eben", { fetchImpl: vi.fn(async () => response({}, 503)) });
    await expect(unavailable.getMessage("message-1")).rejects.toMatchObject({
      code: "gmail_provider_failed",
      status: 503,
      retryable: true,
    });
  });

  it("classifies a missing message as a permanent history gap, not an expired cursor", async () => {
    const provider = createGmailReplyProvider(env(), "Eben", { fetchImpl: vi.fn(async () => response({}, 404)) });

    await expect(provider.getMessage("missing-message")).rejects.toMatchObject({
      code: "gmail_message_missing",
      status: 404,
      retryable: false,
    });
  });

  it("treats Gmail quota 403 reasons as retryable provider failures", async () => {
    const provider = createGmailReplyProvider(env(), "Eben", {
      fetchImpl: vi.fn(async () => response({
        error: { errors: [{ reason: "userRateLimitExceeded" }], status: "RESOURCE_EXHAUSTED" },
      }, 403)),
    });

    await expect(provider.listHistoryPage({ startHistoryId: "123" })).rejects.toMatchObject({
      code: "gmail_provider_failed",
      status: 403,
      retryable: true,
    });
  });

  it("refreshes one stale cached token and retries a Gmail 401 exactly once", async () => {
    const environment = env();
    const originalGet = environment.PORTAL_KV.get;
    environment.PORTAL_KV.get = vi.fn(async (key) => {
      if (key === "amari-mail:eben:refresh_token") return "refresh-token";
      return originalGet(key);
    });
    vi.stubGlobal("fetch", vi.fn(async () => response({ access_token: "fresh-token", expires_in: 3600 })));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ error: { errors: [{ reason: "authError" }] } }, 401))
      .mockResolvedValueOnce(response({ history: [], historyId: "124" }));
    const provider = createGmailReplyProvider(environment, "Eben", { fetchImpl });

    await expect(provider.listHistoryPage({ startHistoryId: "123" })).resolves.toEqual({
      history: [], nextPageToken: null, historyId: "124",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer private-access-token");
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-token");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not loop when Gmail rejects the one forced-refresh retry", async () => {
    const environment = env();
    const originalGet = environment.PORTAL_KV.get;
    environment.PORTAL_KV.get = vi.fn(async (key) => {
      if (key === "amari-mail:eben:refresh_token") return "refresh-token";
      return originalGet(key);
    });
    vi.stubGlobal("fetch", vi.fn(async () => response({ access_token: "fresh-token", expires_in: 3600 })));
    const fetchImpl = vi.fn(async () => response({ error: { errors: [{ reason: "authError" }] } }, 401));
    const provider = createGmailReplyProvider(environment, "Eben", { fetchImpl });

    await expect(provider.listHistoryPage({ startHistoryId: "123" })).rejects.toMatchObject({
      code: "gmail_auth_failed",
      status: 401,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves retry clues from transient token storage failures", async () => {
    const environment = env();
    environment.PORTAL_KV.get.mockRejectedValue(new Error("KV unavailable"));
    const fetchImpl = vi.fn();
    const provider = createGmailReplyProvider(environment, "Eben", { fetchImpl });

    await expect(provider.listHistoryPage({ startHistoryId: "123" })).rejects.toMatchObject({
      code: "gmail_provider_failed",
      status: 503,
      retryable: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("wraps unusable grants as auth failures without calling Gmail", async () => {
    const environment = env();
    environment.PORTAL_KV.get.mockResolvedValue(null);
    const fetchImpl = vi.fn();
    const provider = createGmailReplyProvider(environment, "Eben", { fetchImpl });

    await expect(provider.listHistoryPage({ startHistoryId: "123" })).rejects.toMatchObject({
      code: "gmail_auth_failed",
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["history", { history: [], historyId: 123 }],
    ["history", { history: "wrong", historyId: "123" }],
    ["history", { history: [{ id: "123", messagesAdded: [{ message: { id: true, threadId: "t-1" } }] }], historyId: "124" }],
    ["history", { history: [{ id: "123", messagesAdded: [{ message: { id: "m-1", threadId: 7 } }] }], historyId: "124" }],
    ["history", { history: [], historyId: "9223372036854775808" }],
    ["history", { history: [{ id: "9223372036854775808", messagesAdded: [] }], historyId: "124" }],
    ["message", { id: "different", threadId: "t-1", historyId: "123", internalDate: "1786208400000", payload: {} }],
    ["message", { id: "m-1", threadId: "t-1", historyId: 123, internalDate: "1786208400000", payload: {} }],
    ["message", { id: "m-1", threadId: "t-1", historyId: "9223372036854775808", internalDate: "1786208400000", payload: {} }],
    ["message", { id: "m-1", threadId: "t-1", historyId: "123", internalDate: "8640000000000001", payload: {} }],
  ])("rejects malformed %s payloads", async (kind, payload) => {
    const provider = createGmailReplyProvider(env(), "Eben", { fetchImpl: vi.fn(async () => response(payload)) });
    const operation = kind === "history"
      ? provider.listHistoryPage({ startHistoryId: "123" })
      : provider.getMessage("m-1");
    await expect(operation).rejects.toMatchObject({
      code: "malformed_provider_payload",
      status: 502,
      retryable: false,
    });
  });

  it("contains no Gmail send endpoint or non-GET provider request", () => {
    const source = readFileSync(new URL("./gmail-reply-provider.js", import.meta.url), "utf8");
    expect(source).not.toContain("messages/send");
    expect(source).not.toContain("sendGmailEmail");
    expect(source).not.toMatch(/method:\s*["']POST["']/);
  });

  it("exports typed provider errors", () => {
    const error = new GmailReplyProviderError("failed", "gmail_provider_failed", 503, true);
    expect(error).toMatchObject({
      name: "GmailReplyProviderError",
      code: "gmail_provider_failed",
      status: 503,
      retryable: true,
    });
  });
});
