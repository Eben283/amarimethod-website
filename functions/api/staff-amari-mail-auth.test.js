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

describe("POST /api/staff-amari-mail-auth", () => {
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
    const authorizationUrl = new URL((await response.json()).authorizationUrl);
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
    environment.PORTAL_KV.get.mockImplementation(async (key) => key === "amari-mail:eben:grant_status" ? JSON.stringify({
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      actor: "Eben",
      mailbox: "eben@amarimethod.com",
      oauthConfigured: true,
      grantVerified: true,
      deliveryEnabled: false,
      replySyncEnabled: false,
      fallbackProvider: null,
      blockers: expect.arrayContaining([
        "DKIM and DMARC are not verified",
        "inbound Gmail reply sync is not implemented",
        "delivery command dispatcher is not activated",
        "provider outcomes are not ingested into Communication",
      ]),
    });
    expect(environment.PORTAL_KV.get).toHaveBeenCalledWith("amari-mail:eben:grant_status");
    expect(environment.PORTAL_KV.get).not.toHaveBeenCalledWith("amari-mail:garrett:grant_status");
  });
});
