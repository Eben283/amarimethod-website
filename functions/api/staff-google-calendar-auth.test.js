import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestPost } from "./staff-google-calendar-auth.js";

afterEach(() => vi.unstubAllGlobals());

async function token(payload, secret = "test-secret") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

function environment(values = {}) {
  return {
    JWT_SECRET: "test-secret",
    GOOGLE_OAUTH_CLIENT_ID: "calendar-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "calendar-secret",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "amari-internal-client",
    AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "amari-internal-secret",
    PORTAL_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ...values,
  };
}

async function request(method = "GET", actor = "Garrett") {
  const auth = await token({ role: "staff", user: actor, exp: Date.now() + 60_000 });
  return new Request("https://www.amarimethod.com/api/staff-google-calendar-auth", {
    method,
    headers: { Authorization: `Bearer ${auth}`, Origin: "https://www.amarimethod.com" },
  });
}

describe("Staff Google Calendar authorization", () => {
  it("starts a signed-in Garrett-only calendar consent without activating booking", async () => {
    const env = environment();
    const response = await onRequestPost({ request: await request("POST"), env });
    expect(response.status).toBe(200);
    const payload = await response.json();
    const authorizationUrl = new URL(payload.authorizationUrl);
    expect(payload).toMatchObject({ actor: "Garrett", requiredPrimaryCalendarId: "garrett@amarimethod.com", bookingActivationEnabled: false });
    expect(authorizationUrl.searchParams.get("client_id")).toBe("amari-internal-client");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://www.amarimethod.com/api/staff-amari-mail-callback");
    expect(authorizationUrl.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar");
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^sc2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const statePayload = JSON.parse(new TextDecoder().decode(Uint8Array.from(
      atob(authorizationUrl.searchParams.get("state").split(".")[1].replaceAll("-", "+").replaceAll("_", "/").padEnd(4 * Math.ceil(authorizationUrl.searchParams.get("state").split(".")[1].length / 4), "=")),
      (character) => character.charCodeAt(0),
    )));
    expect(env.PORTAL_KV.put).toHaveBeenCalledWith(
      `staff-calendar:oauth-state:${statePayload.nonce}`,
      expect.stringContaining('"actor":"Garrett"'),
      { expirationTtl: 600 },
    );
  });

  it("reports an absent Garrett grant without contacting Google or enabling booking", async () => {
    const env = environment();
    env.PORTAL_KV.get.mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await onRequestGet({ request: await request(), env });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actor: "Garrett", connectionStatus: "absent", grantVerified: false, bookingActivationEnabled: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verifies the exact Garrett primary writer calendar but keeps booking off", async () => {
    const env = environment();
    env.PORTAL_KV.get.mockImplementation(async (key) => {
      if (key === "google:garrett:access_token") return "access";
      if (key === "google:garrett:refresh_token") return "refresh";
      if (key === "google:garrett:token_expiry") return String(Date.now() + 60 * 60 * 1000);
      return null;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{
      id: "garrett@amarimethod.com", summary: "Garrett", accessRole: "owner", primary: true, timeZone: "America/Los_Angeles",
    }] }), { status: 200 })));
    const response = await onRequestGet({ request: await request(), env });
    expect(await response.json()).toMatchObject({
      connectionStatus: "verified",
      grantVerified: true,
      bookingActivationEnabled: false,
      calendars: [{ id: "garrett@amarimethod.com", primary: true, accessRole: "owner" }],
    });
  });

  it("rejects unknown Staff identities", async () => {
    const response = await onRequestPost({ request: await request("POST", "Other"), env: environment() });
    expect(response.status).toBe(403);
  });
});
