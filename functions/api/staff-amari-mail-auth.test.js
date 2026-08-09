import { describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestPost } from "./staff-amari-mail-auth.js";

async function staffToken(user = "Eben", secret = "test-secret") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify({ role: "staff", user, exp: Date.now() + 60_000 }));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

function env(overrides = {}) {
  return {
    JWT_SECRET: "test-secret",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "amari-mail-client",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "amari-mail-secret",
    PORTAL_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ...overrides,
  };
}

describe("Staff Amari mail authorization", () => {
  it("gives authenticated Eben a signed one-time Amari mail consent URL with reply-read scope", async () => {
    const environment = env();
    const token = await staffToken();
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Origin: "https://www.amarimethod.com" },
      }),
      env: environment,
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      actor: "Eben",
      mailbox: "eben@amarimethod.com",
      deliveryEnabled: false,
    });
    const authorizationUrl = new URL(payload.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("amari-mail-client");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://www.amarimethod.com/api/staff-amari-mail-callback");
    expect(authorizationUrl.searchParams.get("scope")).toBe([
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.settings.basic",
      "https://www.googleapis.com/auth/gmail.readonly",
    ].join(" "));
    const [nonce, signature, ...extra] = authorizationUrl.searchParams.get("state").split(".");
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(extra).toEqual([]);
    expect(environment.PORTAL_KV.put).toHaveBeenCalledWith(
      `amari-mail:oauth-state:${nonce}`,
      expect.stringMatching(/"actor":"Eben".*"requiredSender":"eben@amarimethod\.com"/),
      { expirationTtl: 600 },
    );
  });

  it("derives Garrett's separate exact mailbox only from his signed Staff session", async () => {
    const environment = env();
    const token = await staffToken("Garrett");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Origin: "https://www.amarimethod.com", "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Eben", sender: "eben@amarimethod.com" }),
      }),
      env: environment,
    });

    expect(response.status).toBe(200);
    const state = new URL((await response.json()).authorizationUrl).searchParams.get("state");
    const nonce = state.split(".")[0];
    expect(environment.PORTAL_KV.put).toHaveBeenCalledWith(
      `amari-mail:oauth-state:${nonce}`,
      expect.stringMatching(/"actor":"Garrett".*"requiredSender":"garrett@amarimethod\.com"/),
      { expirationTtl: 600 },
    );
  });

  it("rejects unknown Staff identities and ignores personal OAuth configuration", async () => {
    const environment = env({
      AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: undefined,
      AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: undefined,
      GOOGLE_OAUTH_CLIENT_ID: "personal-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "personal-secret",
    });
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        method: "POST",
        headers: { Authorization: `Bearer ${await staffToken("Staff")}`, Origin: "https://www.amarimethod.com" },
      }),
      env: environment,
    });
    expect(response.status).toBe(403);
    expect(environment.PORTAL_KV.put).not.toHaveBeenCalled();
  });

  it("exposes actor-specific grant readiness while delivery and reply sync remain off", async () => {
    const environment = env();
    environment.PORTAL_KV.get.mockImplementation(async (key) => {
      if (key === "amari-mail:eben:refresh_token") return "private-refresh-token";
      return key === "amari-mail:eben:grant_status" ? JSON.stringify({
        actor: "Eben",
        profileEmail: "eben@amarimethod.com",
        verifiedSendAs: ["eben@amarimethod.com"],
        scopes: [
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/gmail.settings.basic",
          "https://www.googleapis.com/auth/gmail.readonly",
        ],
      }) : null;
    });
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        headers: { Authorization: `Bearer ${await staffToken("Eben")}` },
      }),
      env: environment,
    });

    expect(response.status).toBe(200);
    const readiness = await response.json();
    expect(readiness).toMatchObject({
      actor: "Eben",
      mailbox: "eben@amarimethod.com",
      oauthConfigured: true,
      configurationStatus: "configured",
      connectionStatus: "verified",
      grantPresent: true,
      grantConnected: true,
      grantVerified: true,
      profileReady: true,
      scopesReady: true,
      sendAsReady: true,
      credentialReady: true,
      deliveryEnabled: false,
      replySyncEnabled: false,
      fallbackProvider: null,
      blockers: expect.arrayContaining([
        "Gmail delivery is disabled; no delivery dispatcher is active",
        "Inbound Gmail watch and ingestion are not active",
        "Gmail provider outcomes are not connected to the Communication surface",
      ]),
    });
    expect(JSON.stringify(readiness)).not.toContain("private-refresh-token");
    expect(environment.PORTAL_KV.get).toHaveBeenCalledWith("amari-mail:eben:grant_status");
    expect(environment.PORTAL_KV.get).toHaveBeenCalledWith("amari-mail:eben:refresh_token");
    expect(environment.PORTAL_KV.get).not.toHaveBeenCalledWith("amari-mail:garrett:grant_status");
  });

  it("distinguishes an absent grant from an invalid grant without exposing credential material", async () => {
    const environment = env();
    const request = new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
      headers: { Authorization: `Bearer ${await staffToken("Garrett")}` },
    });

    const absent = await onRequestGet({ request, env: environment });
    await expect(absent.json()).resolves.toMatchObject({
      actor: "Garrett",
      mailbox: "garrett@amarimethod.com",
      configurationStatus: "configured",
      connectionStatus: "absent",
      grantPresent: false,
      grantConnected: false,
      grantVerified: false,
      credentialReady: false,
      blockers: expect.arrayContaining(["No verified Amari Gmail grant is connected for Garrett"]),
    });
    expect(environment.PORTAL_KV.get).not.toHaveBeenCalledWith("amari-mail:garrett:refresh_token");

    environment.PORTAL_KV.get.mockImplementation(async (key) => {
      if (key === "amari-mail:garrett:refresh_token") return "must-not-leak";
      if (key === "amari-mail:garrett:grant_status") return JSON.stringify({
        actor: "Eben",
        profileEmail: "eben@amarimethod.com",
        verifiedSendAs: ["eben@amarimethod.com"],
        scopes: ["https://www.googleapis.com/auth/gmail.send"],
      });
      return null;
    });
    const invalid = await onRequestGet({
      request: new Request(request.url, { headers: request.headers }),
      env: environment,
    });
    const invalidPayload = await invalid.json();
    expect(invalidPayload).toMatchObject({
      actor: "Garrett",
      mailbox: "garrett@amarimethod.com",
      connectionStatus: "invalid",
      grantPresent: true,
      grantConnected: false,
      grantVerified: false,
      profileReady: false,
      scopesReady: false,
      sendAsReady: false,
      credentialReady: true,
      blockers: expect.arrayContaining([
        "The stored grant does not belong to Garrett",
        "The connected Google profile does not match garrett@amarimethod.com",
        "The connected grant is missing required Gmail scopes",
        "Gmail has not verified garrett@amarimethod.com as an approved SendAs identity",
      ]),
    });
    expect(JSON.stringify(invalidPayload)).not.toContain("must-not-leak");
  });

  it("reports Amari mail as unconfigured without reading grant or credential keys", async () => {
    const environment = env({ AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: undefined });
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        headers: { Authorization: `Bearer ${await staffToken("Eben")}` },
      }),
      env: environment,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      actor: "Eben",
      mailbox: "eben@amarimethod.com",
      oauthConfigured: false,
      configurationStatus: "unconfigured",
      connectionStatus: "unconfigured",
      grantPresent: false,
      grantConnected: false,
      grantVerified: false,
      blockers: expect.arrayContaining(["Amari-owned Google OAuth configuration is not available"]),
    });
    expect(environment.PORTAL_KV.get).not.toHaveBeenCalled();
  });

  it("rejects readiness for a signed Staff identity without an exact Amari mailbox", async () => {
    const environment = env();
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        headers: { Authorization: `Bearer ${await staffToken("Staff")}` },
      }),
      env: environment,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Staff mailbox is not authorized" });
    expect(environment.PORTAL_KV.get).not.toHaveBeenCalled();
  });

  it("marks a verified grant invalid when its refresh credential is absent", async () => {
    const environment = env();
    environment.PORTAL_KV.get.mockImplementation(async (key) => key.endsWith(":grant_status") ? JSON.stringify({
      actor: "Eben",
      profileEmail: "eben@amarimethod.com",
      verifiedSendAs: ["eben@amarimethod.com"],
      scopes: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.settings.basic",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
    }) : null);
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        headers: { Authorization: `Bearer ${await staffToken("Eben")}` },
      }),
      env: environment,
    });

    await expect(response.json()).resolves.toMatchObject({
      connectionStatus: "invalid",
      grantPresent: true,
      grantConnected: false,
      grantVerified: false,
      profileReady: true,
      scopesReady: true,
      sendAsReady: true,
      credentialReady: false,
      blockers: expect.arrayContaining(["The verified Amari Gmail grant has no refresh credential"]),
    });
  });

  it("reports readiness storage failures as unavailable rather than unauthorized", async () => {
    const environment = env();
    environment.PORTAL_KV.get.mockRejectedValue(new Error("KV unavailable"));
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
        headers: { Authorization: `Bearer ${await staffToken("Eben")}` },
      }),
      env: environment,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Amari mail readiness is unavailable",
      actor: "Eben",
      mailbox: "eben@amarimethod.com",
      deliveryEnabled: false,
    });
  });
});
