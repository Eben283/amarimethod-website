import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireEbenStaffAuth: vi.fn(),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

import { requireEbenStaffAuth } from "../lib/endpoint-guards.js";
import { onRequestPost } from "./staff-crm-mirror-access.js";

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

function context(env = { WORKER_AUTH_SECRET: "worker-secret" }) {
  return {
    env,
    request: {
      headers: {
        get: (name) => (name === "Origin" ? "https://www.amarimethod.com" : null),
      },
    },
  };
}

describe("staff-crm-mirror-access", () => {
  it("forwards only after Eben staff auth and never returns the worker secret", async () => {
    requireEbenStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        expiresInSeconds: 300,
        url: "https://amari-crm-mirror.eben-fa2.workers.dev/dashboard-access/moss-river-sage-leaf-4217",
      }),
    });

    const response = await onRequestPost(context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toContain("/dashboard-access/");
    expect(JSON.stringify(body)).not.toContain("worker-secret");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/dashboard-access-link",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer worker-secret" },
      }),
    );
  });

  it("returns the Eben-only auth denial without minting a link", async () => {
    requireEbenStaffAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Amari Ops is Eben-only" }), { status: 403 }),
    });

    const response = await onRequestPost(context());
    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when WORKER_AUTH_SECRET is missing", async () => {
    requireEbenStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
    const response = await onRequestPost(context({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "CRM mirror access is not configured" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
