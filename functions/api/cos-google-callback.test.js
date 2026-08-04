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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
    }), { status: 200 })));

    const response = await onRequestGet(ctx);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://www.amarimethod.com/cos/?google=connected");
    expect(ctx.env.PORTAL_KV.delete).toHaveBeenCalledWith("cos:google-oauth:one-time");
    expect(ctx.env.PORTAL_KV.delete).toHaveBeenCalledWith(
      `cos:cache:eben:${new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })}`,
    );
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:access_token", "access");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("google:eben:refresh_token", "refresh");
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
