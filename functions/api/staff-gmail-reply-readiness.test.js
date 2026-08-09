import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.amarimethod.com" }),
}));

import { requireStaffAuth } from "../lib/endpoint-guards.js";
import { onRequestGet } from "./staff-gmail-reply-readiness.js";

function context(env = { WORKER_AUTH_SECRET: "worker-secret" }) {
  return {
    env,
    request: new Request("https://www.amarimethod.com/api/staff-gmail-reply-readiness", {
      headers: { Origin: "https://www.amarimethod.com" },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
  requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
});

describe("Staff Gmail reply evidence proxy", () => {
  it("derives the mailbox actor from the signed Staff session", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ actor: "Eben", replySyncEnabled: false }), { status: 200 }));
    const response = await onRequestGet(context());
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/gmail/reply-readiness?actor=Eben&limit=8",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer worker-secret" } }),
    );
    expect(await response.text()).not.toContain("worker-secret");
  });

  it("fails closed for unknown staff identity or missing server credential", async () => {
    requireStaffAuth.mockResolvedValueOnce({ payload: { role: "staff", user: "Other" } });
    expect((await onRequestGet(context())).status).toBe(403);
    expect((await onRequestGet(context({}))).status).toBe(422);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not turn an upstream failure into a clear readiness state", async () => {
    global.fetch.mockRejectedValue(new Error("offline"));
    const response = await onRequestGet(context());
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Reply evidence is unavailable" });
  });
});
