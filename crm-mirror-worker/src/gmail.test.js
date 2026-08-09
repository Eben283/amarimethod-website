import { afterEach, describe, expect, it, vi } from "vitest";
import { forceRefreshGoogleWorkspaceToken, getGoogleWorkspaceToken, gmailConfigured, listGmailSenders, resolveAmariMailIdentity, sendGmailEmail } from "./gmail.js";

function env(values = {}) {
  const store = new Map(Object.entries(values));
  return { AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "client", AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "secret", PORTAL_KV: { get: vi.fn(async (key) => store.get(key) || null), put: vi.fn(async (key, value) => store.set(key, value)) } };
}
function grant(actor) {
  const email = actor === "Garrett" ? "garrett@amarimethod.com" : "eben@amarimethod.com";
  return JSON.stringify({
    actor,
    profileEmail: email,
    verifiedSendAs: [email],
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.settings.basic",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    deliveryEnabled: false,
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("Gmail provider", () => {
  it("uses only the purpose-bound Amari mail token namespace", async () => {
    const e = env({
      "amari-mail:eben:grant_status": grant("Eben"),
      "amari-mail:eben:access_token": "current-token",
      "amari-mail:eben:token_expiry": String(Date.now() + 600_000),
      "amari-mail:garrett:grant_status": grant("Garrett"),
      "amari-mail:garrett:access_token": "garrett-token",
      "amari-mail:garrett:token_expiry": String(Date.now() + 600_000),
      "amari-mail:access_token": "obsolete-shared-token",
      "google:eben:access_token": "personal-token",
      "google:eben:token_expiry": String(Date.now() + 600_000),
    });
    await expect(getGoogleWorkspaceToken(e, "Eben")).resolves.toBe("current-token");
    await expect(getGoogleWorkspaceToken(e, "Garrett")).resolves.toBe("garrett-token");
    expect(e.PORTAL_KV.get.mock.calls.flat()).not.toContain("google:eben:access_token");
    expect(e.PORTAL_KV.get.mock.calls.flat()).not.toContain("amari-mail:access_token");
  });

  it("refreshes mail access with only Amari-owned OAuth credentials and mail KV keys", async () => {
    const e = env({ "amari-mail:eben:grant_status": grant("Eben"), "amari-mail:eben:refresh_token": "mail-refresh" });
    e.GOOGLE_OAUTH_CLIENT_ID = "personal-client";
    e.GOOGLE_OAUTH_CLIENT_SECRET = "personal-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-mail-token", expires_in: 3600 }), { status: 200 })));

    await expect(getGoogleWorkspaceToken(e, "Eben")).resolves.toBe("fresh-mail-token");
    const requestBody = new URLSearchParams(fetch.mock.calls[0][1].body);
    expect(requestBody.get("client_id")).toBe("client");
    expect(requestBody.get("client_secret")).toBe("secret");
    expect(requestBody.get("refresh_token")).toBe("mail-refresh");
    expect(e.PORTAL_KV.put.mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([
      "amari-mail:eben:access_token",
      "amari-mail:eben:token_expiry",
      "amari-mail:eben:refresh_token",
    ]));
    expect(e.PORTAL_KV.put.mock.calls.flat().join(" ")).not.toContain("google:eben");
  });

  it("can force one actor-scoped refresh without reusing a stale cached access token", async () => {
    const e = env({
      "amari-mail:eben:grant_status": grant("Eben"),
      "amari-mail:eben:access_token": "stale-token",
      "amari-mail:eben:token_expiry": String(Date.now() + 600_000),
      "amari-mail:eben:refresh_token": "mail-refresh",
      "amari-mail:garrett:refresh_token": "wrong-actor-refresh",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "fresh-mail-token", expires_in: 3600,
    }), { status: 200 })));

    await expect(forceRefreshGoogleWorkspaceToken(e, "Eben")).resolves.toBe("fresh-mail-token");
    const requestBody = new URLSearchParams(fetch.mock.calls[0][1].body);
    expect(requestBody.get("refresh_token")).toBe("mail-refresh");
    expect(e.PORTAL_KV.get.mock.calls.flat()).not.toContain("amari-mail:garrett:refresh_token");
  });

  it("marks token storage read and write failures as retryable provider failures", async () => {
    const readFailure = env({ "amari-mail:eben:grant_status": grant("Eben") });
    readFailure.PORTAL_KV.get.mockRejectedValue(new Error("KV read unavailable"));
    await expect(getGoogleWorkspaceToken(readFailure, "Eben")).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });

    const writeFailure = env({
      "amari-mail:eben:grant_status": grant("Eben"),
      "amari-mail:eben:refresh_token": "mail-refresh",
    });
    writeFailure.PORTAL_KV.put.mockRejectedValue(new Error("KV write unavailable"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "fresh-mail-token", expires_in: 3600,
    }), { status: 200 })));
    await expect(forceRefreshGoogleWorkspaceToken(writeFailure, "Eben")).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
  });

  it.each(["NaN", -1, 0])("rejects invalid OAuth expires_in before persisting it (%s)", async (expiresIn) => {
    const e = env({
      "amari-mail:eben:grant_status": grant("Eben"),
      "amari-mail:eben:refresh_token": "mail-refresh",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "fresh-mail-token", expires_in: expiresIn,
    }), { status: 200 })));

    await expect(forceRefreshGoogleWorkspaceToken(e, "Eben")).rejects.toMatchObject({
      status: 502,
      retryable: true,
    });
    expect(e.PORTAL_KV.put).not.toHaveBeenCalled();
  });

  it("does not treat personal or Calendar OAuth credentials as mail configuration", async () => {
    const portalKv = { get: vi.fn(), put: vi.fn() };
    const personalConfiguration = {
      PORTAL_KV: portalKv,
      GOOGLE_OAUTH_CLIENT_ID: "personal-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "personal-secret",
    };

    expect(gmailConfigured(personalConfiguration)).toBe(false);
    await expect(getGoogleWorkspaceToken(personalConfiguration, "Eben")).rejects.toThrow("Amari mail is not configured");
    expect(portalKv.get).not.toHaveBeenCalled();
  });

  it("maps each signed Staff actor to an exact server-owned From and Reply-To identity", () => {
    expect(resolveAmariMailIdentity("Eben")).toEqual({
      actor: "Eben",
      from: "eben@amarimethod.com",
      replyTo: "eben@amarimethod.com",
    });
    expect(resolveAmariMailIdentity("Garrett")).toEqual({
      actor: "Garrett",
      from: "garrett@amarimethod.com",
      replyTo: "garrett@amarimethod.com",
    });
  });

  it("rejects personal or caller-supplied sender identities before a provider call", async () => {
    const e = env({ "amari-mail:eben:grant_status": grant("Eben"), "amari-mail:eben:access_token": "current-token", "amari-mail:eben:token_expiry": String(Date.now() + 600_000) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "must-not-send" }), { status: 200 })));

    expect(() => resolveAmariMailIdentity("Staff")).toThrow("does not have an Amari mail identity");
    await expect(sendGmailEmail(e, {
      actor: "Eben",
      from: "eben@ebenforrest.com",
      replyTo: "eben@ebenforrest.com",
      to: "person@example.test",
      senders: [{ address: "eben@ebenforrest.com" }],
      subject: "A subject",
      text: "Private body",
    })).rejects.toThrow("sender identity is server-owned");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cannot bypass live Gmail SendAs verification with caller-supplied provider evidence", async () => {
    const e = env({ "amari-mail:eben:grant_status": grant("Eben"), "amari-mail:eben:access_token": "current-token", "amari-mail:eben:token_expiry": String(Date.now() + 600_000) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));

    await expect(sendGmailEmail(e, {
      actor: "Eben",
      to: "person@example.test",
      senders: [{ address: "eben@amarimethod.com" }],
      subject: "A subject",
      text: "Private body",
    })).rejects.toThrow("Gmail sender identities unavailable (403)");
    expect(fetch.mock.calls[0][0]).toContain("gmail/v1/users/me/settings/sendAs");
  });

  it("sends a text email through Gmail without exposing the token in the payload", async () => {
    const e = env({ "amari-mail:eben:grant_status": grant("Eben"), "amari-mail:eben:access_token": "current-token", "amari-mail:eben:token_expiry": String(Date.now() + 600_000) });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sendAs: [{ sendAsEmail: "eben@amarimethod.com", verificationStatus: "accepted" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "gmail-id", threadId: "thread-id" }), { status: 200 })));
    await expect(sendGmailEmail(e, { actor: "Eben", to: "person@example.test", subject: "A subject", text: "Private body" })).resolves.toEqual({ id: "gmail-id", threadId: "thread-id" });
    const [url, request] = fetch.mock.calls[1];
    expect(url).toContain("gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(request.headers.Authorization).toBe("Bearer current-token");
    expect(request.body).not.toContain("current-token");
    expect(JSON.parse(request.body).raw).toBeTruthy();
    const decoded = Buffer.from(JSON.parse(request.body).raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: eben@amarimethod.com");
    expect(decoded).toContain("Reply-To: eben@amarimethod.com");
  });

  it("lists only exact server-owned identities that Gmail has accepted", async () => {
    const e = env({ "amari-mail:eben:grant_status": grant("Eben"), "amari-mail:eben:access_token": "current-token", "amari-mail:eben:token_expiry": String(Date.now() + 600_000) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sendAs: [
      { sendAsEmail: "eben@amarimethod.com", displayName: "Eben", verificationStatus: "accepted", isDefault: true },
      { sendAsEmail: "garrett@amarimethod.com", displayName: "Garrett", verificationStatus: "accepted" },
      { sendAsEmail: "pending@amarimethod.com", verificationStatus: "pending" },
      { sendAsEmail: "primary@amarimethod.com", isPrimary: true },
      { sendAsEmail: "eben@ebenforrest.com", verificationStatus: "accepted", isPrimary: true },
    ] }), { status: 200 })));
    await expect(listGmailSenders(e, "Eben")).resolves.toEqual([
      { address: "eben@amarimethod.com", name: "Eben", isDefault: true, isPrimary: false },
    ]);
  });

  it("fails closed when actor-specific verified grant status is absent", async () => {
    const e = env({
      "amari-mail:eben:access_token": "unactivated-token",
      "amari-mail:eben:token_expiry": String(Date.now() + 600_000),
    });
    vi.stubGlobal("fetch", vi.fn());
    await expect(getGoogleWorkspaceToken(e, "Eben")).rejects.toThrow("Amari mail grant is not verified");
    expect(fetch).not.toHaveBeenCalled();
  });
});
