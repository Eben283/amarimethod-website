import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost as startAuthorization } from "./staff-amari-mail-auth.js";
import { onRequestGet as completeAuthorization } from "./staff-amari-mail-callback.js";
import { onRequestPost as startCalendarAuthorization } from "./staff-google-calendar-auth.js";

afterEach(() => vi.unstubAllGlobals());
const GRANTED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

async function staffToken(user = "Eben", secret = "test-secret") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify({ role: "staff", user, exp: Date.now() + 60_000 }));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

function environment() {
  const store = new Map();
  const writes = [];
  const kv = {
    get: vi.fn(async (key) => store.get(key) || null),
    put: vi.fn(async (key, value, options) => { store.set(key, value); writes.push({ key, value, options }); }),
    delete: vi.fn(async (key) => store.delete(key)),
  };
  return {
    JWT_SECRET: "test-secret",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "amari-mail-client",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "amari-mail-secret",
    GOOGLE_OAUTH_CLIENT_ID: "personal-calendar-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "personal-calendar-secret",
    PORTAL_KV: kv,
    store,
    writes,
  };
}

async function signedState(env, actor = "Eben") {
  const response = await startAuthorization({
    request: new Request("https://www.amarimethod.com/api/staff-amari-mail-auth", {
      method: "POST",
      headers: { Authorization: `Bearer ${await staffToken(actor)}`, Origin: "https://www.amarimethod.com" },
    }),
    env,
  });
  return new URL((await response.json()).authorizationUrl).searchParams.get("state");
}

async function calendarState(env, actor = "Garrett") {
  const response = await startCalendarAuthorization({
    request: new Request("https://www.amarimethod.com/api/staff-google-calendar-auth", {
      method: "POST",
      headers: { Authorization: `Bearer ${await staffToken(actor)}`, Origin: "https://www.amarimethod.com" },
    }),
    env,
  });
  return new URL((await response.json()).authorizationUrl).searchParams.get("state");
}

describe("GET /api/staff-amari-mail-callback", () => {
  it("completes Garrett's calendar-only grant through the internal Amari OAuth client without connecting mail or activating booking", async () => {
    const env = environment();
    const state = await calendarState(env);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "calendar-access",
        refresh_token: "calendar-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        id: "garrett@amarimethod.com", summary: "Garrett", accessRole: "owner", primary: true,
      }] }), { status: 200 })));

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${state}&code=grant-code`),
      env,
    });

    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/staff/operations?staffCalendar=connected");
    const exchange = new URLSearchParams(fetch.mock.calls[0][1].body);
    expect(exchange.get("client_id")).toBe("amari-mail-client");
    expect(exchange.get("client_secret")).toBe("amari-mail-secret");
    expect(exchange.get("redirect_uri")).toBe("https://www.amarimethod.com/api/staff-amari-mail-callback");
    expect([...env.store.keys()]).toEqual(expect.arrayContaining([
      "google:garrett:access_token",
      "google:garrett:refresh_token",
      "google:garrett:grant_status",
    ]));
    expect([...env.store.keys()].some((key) => key.startsWith("amari-mail:garrett:"))).toBe(false);
    const marker = JSON.parse(env.store.get("google:garrett:grant_status"));
    expect(marker).toMatchObject({
      actor: "Garrett",
      primaryCalendarId: "garrett@amarimethod.com",
      bookingActivationEnabled: false,
      oauthCredentialFamily: "amari_internal",
    });
    expect(JSON.parse(env.store.get("google:garrett:last_oauth_result"))).toMatchObject({
      actor: "Garrett", status: "connected", stage: "complete", code: "grant_verified",
      bookingActivationEnabled: false,
    });
  });

  it("accepts a valid signed calendar state when immediate cross-PoP KV has not propagated", async () => {
    const env = environment();
    const state = await calendarState(env);
    env.store.clear();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "calendar-access", refresh_token: "calendar-refresh", expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        id: "garrett@amarimethod.com", summary: "Garrett", accessRole: "owner", primary: true,
      }] }), { status: 200 })));

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&code=grant-code`),
      env,
    });

    expect(response.headers.get("Location")).toContain("staffCalendar=connected");
    expect(env.store.has("google:garrett:grant_status")).toBe(true);
  });

  it("persists a safe failure stage without storing partial credentials", async () => {
    const env = environment();
    const state = await calendarState(env);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&code=grant-code`),
      env,
    });

    expect(response.headers.get("Location")).toContain("staffCalendar=failed");
    expect(JSON.parse(env.store.get("google:garrett:last_oauth_result"))).toMatchObject({
      actor: "Garrett", status: "failed", stage: "token_exchange", code: "token_exchange_failed",
      bookingActivationEnabled: false,
    });
    expect([...env.store.keys()].filter((key) => /access_token|refresh_token|grant_status/.test(key))).toEqual([]);
  });

  it("rejects a tampered calendar state before KV or Google", async () => {
    const env = environment();
    const state = await calendarState(env);
    env.PORTAL_KV.get.mockClear();
    env.PORTAL_KV.delete.mockClear();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const [prefix, payload] = state.split(".");

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${prefix}.${payload}.${"A".repeat(43)}&code=grant-code`),
      env,
    });

    expect(response.headers.get("Location")).toContain("staffCalendar=failed");
    expect(env.PORTAL_KV.get).not.toHaveBeenCalled();
    expect(env.PORTAL_KV.delete).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores only a verified Amari-domain grant after checking every required exact SendAs identity", async () => {
    const env = environment();
    const state = await signedState(env);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "mail-access", refresh_token: "mail-refresh", expires_in: 3600, scope: GRANTED_SCOPES }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "eben@amarimethod.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sendAs: [
        { sendAsEmail: "eben@amarimethod.com", verificationStatus: "accepted" },
        { sendAsEmail: "eben@ebenforrest.com", verificationStatus: "accepted", isPrimary: true },
      ] }), { status: 200 })));

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&code=grant-code`),
      env,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/staff/operations?amariMail=connected");
    expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("client_id")).toBe("amari-mail-client");
    expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("client_secret")).toBe("amari-mail-secret");
    expect(fetch.mock.calls[1][0]).toContain("gmail/v1/users/me/profile");
    expect(fetch.mock.calls[2][0]).toContain("gmail/v1/users/me/settings/sendAs");
    expect(env.writes.map(({ key }) => key)).toEqual(expect.arrayContaining([
      "amari-mail:eben:access_token",
      "amari-mail:eben:refresh_token",
      "amari-mail:eben:token_expiry",
      "amari-mail:eben:grant_status",
    ]));
    expect(env.writes.every(({ key }) => key.startsWith("amari-mail:"))).toBe(true);
    expect(env.writes.map(({ key }) => key).join(" ")).not.toContain("google:eben");
    const grant = JSON.parse(env.writes.find(({ key }) => key === "amari-mail:eben:grant_status").value);
    expect(grant).toMatchObject({
      actor: "Eben",
      profileEmail: "eben@amarimethod.com",
      verifiedSendAs: ["eben@amarimethod.com"],
      deliveryEnabled: false,
      replySyncEnabled: false,
    });
  });

  it("rejects tampered state before KV or Google and consumes a valid state only once", async () => {
    const env = environment();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tampered = await completeAuthorization({
      request: new Request("https://www.amarimethod.com/api/staff-amari-mail-callback?state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&code=grant-code"),
      env,
    });
    expect(tampered.headers.get("Location")).toContain("amariMail=failed");
    expect(env.PORTAL_KV.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const state = await signedState(env);
    const first = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&error=access_denied`),
      env,
    });
    const replay = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&code=grant-code`),
      env,
    });
    expect(first.headers.get("Location")).toContain("amariMail=failed");
    expect(replay.headers.get("Location")).toContain("amariMail=failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores Garrett's grant only in Garrett's actor namespace", async () => {
    const env = environment();
    const state = await signedState(env, "Garrett");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "garrett-access", refresh_token: "garrett-refresh", scope: GRANTED_SCOPES }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "garrett@amarimethod.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sendAs: [{ sendAsEmail: "garrett@amarimethod.com", isPrimary: true }] }), { status: 200 })));

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&code=grant-code`),
      env,
    });

    expect(response.headers.get("Location")).toContain("amariMail=connected");
    expect([...env.store.keys()]).toEqual(expect.arrayContaining([
      "amari-mail:garrett:access_token",
      "amari-mail:garrett:refresh_token",
      "amari-mail:garrett:grant_status",
    ]));
    expect([...env.store.keys()].some((key) => key.startsWith("amari-mail:eben:"))).toBe(false);
  });

  it("stores no token when the Google profile is personal or the exact actor SendAs is absent", async () => {
    const env = environment();
    const state = await signedState(env);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "personal-access", refresh_token: "personal-refresh", scope: GRANTED_SCOPES }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "eben@ebenforrest.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sendAs: [
        { sendAsEmail: "garrett@amarimethod.com", verificationStatus: "accepted" },
      ] }), { status: 200 })));

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&code=grant-code`),
      env,
    });

    expect(response.headers.get("Location")).toContain("amariMail=failed");
    expect(env.writes.map(({ key }) => key)).not.toEqual(expect.arrayContaining([
      "amari-mail:eben:access_token",
      "amari-mail:eben:refresh_token",
      "amari-mail:eben:grant_status",
    ]));
  });

  it("removes partial actor tokens and leaves grant status inactive when KV storage fails", async () => {
    const env = environment();
    const state = await signedState(env);
    const normalPut = env.PORTAL_KV.put.getMockImplementation();
    env.PORTAL_KV.put.mockImplementation(async (key, value, options) => {
      if (key === "amari-mail:eben:refresh_token") throw new Error("KV unavailable");
      return normalPut(key, value, options);
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "mail-access", refresh_token: "mail-refresh", scope: GRANTED_SCOPES }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "eben@amarimethod.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sendAs: [{ sendAsEmail: "eben@amarimethod.com", verificationStatus: "accepted" }] }), { status: 200 })));

    const response = await completeAuthorization({
      request: new Request(`https://www.amarimethod.com/api/staff-amari-mail-callback?state=${encodeURIComponent(state)}&code=grant-code`),
      env,
    });

    expect(response.headers.get("Location")).toContain("amariMail=failed");
    expect([...env.store.keys()].filter((key) => key.startsWith("amari-mail:eben:"))).toEqual([]);
  });
});
