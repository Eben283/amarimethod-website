import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./cos-google-callback.js";

afterEach(() => vi.unstubAllGlobals());

function context(url, env = {}) {
  return {
    request: new Request(url),
    env: {
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      PORTAL_KV: { get: vi.fn(), delete: vi.fn(), put: vi.fn() },
      ...env,
    },
  };
}

describe("GET /api/cos-google-callback", () => {
  it("exchanges a valid one-time code and stores only Eben's namespaced tokens", async () => {
    const ctx = context("https://www.amarimethod.com/api/cos-google-callback?state=one-time&code=grant-code");
    ctx.env.PORTAL_KV.get.mockResolvedValue(JSON.stringify({ user: "Eben" }));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        id: "eben@ebenforrest.com", summary: "Eben", accessRole: "owner", primary: true,
      }] }), { status: 200 })));

    const response = await onRequestGet(ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/cos/?google=connected");
    expect(ctx.env.PORTAL_KV.delete).toHaveBeenCalledWith("cos:google-oauth:one-time");
    expect(ctx.env.PORTAL_KV.delete).toHaveBeenCalledWith(
      `cos:cache:eben:${new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })}`,
    );
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:access_token", "access");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:refresh_token", "refresh");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:grant_status", expect.stringContaining('"primaryCalendarId":"eben@ebenforrest.com"'));
  });

  it("completes Garrett's signed-in Staff calendar grant without activating booking", async () => {
    const state = "a".repeat(64);
    const ctx = context(`https://www.amarimethod.com/api/cos-google-callback?state=${state}&code=grant-code`);
    ctx.env.PORTAL_KV.get.mockImplementation(async (key) => key === `staff-calendar:oauth-state:${state}`
      ? JSON.stringify({ flow: "staff_appointment_calendar", actor: "Garrett", requiredPrimaryCalendarId: "garrett@amarimethod.com" })
      : null);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "garrett-access",
        refresh_token: "garrett-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        id: "garrett@amarimethod.com", summary: "Garrett", accessRole: "owner", primary: true,
      }] }), { status: 200 })));

    const response = await onRequestGet(ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/staff/operations?staffCalendar=connected");
    expect(ctx.env.PORTAL_KV.delete).toHaveBeenCalledWith(`staff-calendar:oauth-state:${state}`);
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:garrett:access_token", "garrett-access");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:garrett:refresh_token", "garrett-refresh");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:garrett:grant_status", expect.stringContaining('"bookingActivationEnabled":false'));
  });

  it("rejects a Staff grant when the primary calendar belongs to a different identity", async () => {
    const state = "b".repeat(64);
    const ctx = context(`https://www.amarimethod.com/api/cos-google-callback?state=${state}&code=grant-code`);
    ctx.env.PORTAL_KV.get.mockResolvedValue(JSON.stringify({ flow: "staff_appointment_calendar", actor: "Garrett", requiredPrimaryCalendarId: "garrett@amarimethod.com" }));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "wrong", refresh_token: "wrong", scope: "https://www.googleapis.com/auth/calendar" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "someone@example.com", accessRole: "owner", primary: true }] }), { status: 200 })));
    const response = await onRequestGet(ctx);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/staff/operations?staffCalendar=failed");
    expect(ctx.env.PORTAL_KV.put).not.toHaveBeenCalled();
  });

  it("rejects an expired or missing state without contacting Google", async () => {
    const ctx = context("https://www.amarimethod.com/api/cos-google-callback?state=missing&code=grant-code");
    ctx.env.PORTAL_KV.get.mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await onRequestGet(ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/cos/?google=failed");
    expect(ctx.env.PORTAL_KV.delete).toHaveBeenCalledWith("cos:google-oauth:missing");
    expect(fetch).not.toHaveBeenCalled();
  });
});
