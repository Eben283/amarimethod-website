import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

import { requireStaffAuth } from "../lib/endpoint-guards.js";
import { onRequestGet } from "./staff-appointment-readiness.js";

function context(env = { WORKER_AUTH_SECRET: "worker-secret" }) {
  return { env, request: { headers: { get: () => "https://www.amarimethod.com" } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe("staff appointment readiness", () => {
  it("proxies read-only shadow evidence without exposing the worker secret", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff" } });
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({
      configured: true, shadowOnly: true, state: "attention", liveScheduleFallback: true,
      bufferPolicy: { state: "confirmed", runtimeAppOwnedMinutes: 20, historicalDocumentedMinutes: 10 },
    }) });
    const response = await onRequestGet(context());
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/appointments/readiness",
      expect.objectContaining({ headers: { Authorization: "Bearer worker-secret" } }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("worker-secret");
  });

  it("does not contact the shadow when staff authentication fails", async () => {
    requireStaffAuth.mockResolvedValue({ error: new Response("denied", { status: 401 }) });
    const response = await onRequestGet(context());
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns an honest unavailable state without affecting the separate schedule endpoint", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff" } });
    const response = await onRequestGet(context({}));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Appointment shadow is not configured." });
  });
});
