import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

import { requireStaffAuth } from "../lib/endpoint-guards.js";
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
  it("forwards only after staff auth and never returns the worker secret", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Garrett" } });
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
        headers: { Authorization: "Bearer worker-secret", "X-Staff-Actor": "Garrett" },
      }),
    );
  });

  it("returns the staff auth denial without minting a link", async () => {
    requireStaffAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    });

    const response = await onRequestPost(context());
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("requests the dedicated Client Desk handoff without exposing the worker secret", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: "https://crm.test/dashboard-access/desk", expiresInSeconds: 300 }) });
    const deskContext = context();
    deskContext.request.url = "https://www.amarimethod.com/api/staff-crm-mirror-access?view=client-desk";
    await onRequestPost(deskContext);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/dashboard-access-link?view=client-desk",
      expect.objectContaining({ headers: { Authorization: "Bearer worker-secret", "X-Staff-Actor": "Eben" } }),
    );
  });

  it("fails closed when WORKER_AUTH_SECRET is missing", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
    const response = await onRequestPost(context({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "CRM mirror access is not configured" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
