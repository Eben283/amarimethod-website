import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./cos-google-callback.js";
import { createStaffCalendarOAuthState } from "../lib/staff-calendar-oauth.js";

afterEach(() => vi.unstubAllGlobals());

function context(url, env = {}) {
  return {
    request: new Request(url),
    env: {
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "amari-client-id",
      AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "amari-client-secret",
      JWT_SECRET: "jwt-secret",
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

  it("completes Eben's signed-in Staff calendar grant without activating booking", async () => {
    const setup = context("https://example.com");
    const state = await createStaffCalendarOAuthState(setup.env, "Eben");
    const ctx = context(`https://www.amarimethod.com/api/cos-google-callback?state=${state}&code=grant-code`);
    ctx.env.PORTAL_KV.get.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "eben-access",
        refresh_token: "eben-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        id: "eben@ebenforrest.com", summary: "Eben", accessRole: "owner", primary: true,
      }] }), { status: 200 })));

    const response = await onRequestGet(ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/staff/operations?staffCalendar=connected");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:access_token", "eben-access");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:refresh_token", "eben-refresh");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:grant_status", expect.stringContaining('"bookingActivationEnabled":false'));
  });

  it("rejects a Staff grant when the primary calendar belongs to a different identity", async () => {
    const setup = context("https://example.com");
    const state = await createStaffCalendarOAuthState(setup.env, "Eben");
    const ctx = context(`https://www.amarimethod.com/api/cos-google-callback?state=${state}&code=grant-code`);
    ctx.env.PORTAL_KV.get.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "wrong", refresh_token: "wrong", scope: "https://www.googleapis.com/auth/calendar" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "someone@example.com", accessRole: "owner", primary: true }] }), { status: 200 })));
    const response = await onRequestGet(ctx);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/staff/operations?staffCalendar=failed");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:last_oauth_result", expect.stringContaining('"code":"primary_calendar_mismatch"'), { expirationTtl: 604800 });
    expect(ctx.env.PORTAL_KV.put.mock.calls.some(([key]) => /access_token|refresh_token|grant_status/.test(key))).toBe(false);
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
