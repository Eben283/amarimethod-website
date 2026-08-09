import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.amarimethod.com" }),
}));

import { requireStaffAuth } from "../lib/endpoint-guards.js";
import { onRequestGet, onRequestPost } from "./staff-followups.js";

function context(method = "GET", body, env = { WORKER_AUTH_SECRET: "worker-secret" }) {
  return {
    env,
    request: new Request("https://www.amarimethod.com/api/staff-followups", {
      method,
      headers: { Origin: "https://www.amarimethod.com", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
  requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
});

describe("Staff owned follow-ups proxy", () => {
  it("lists follow-ups behind staff auth without exposing the worker credential", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, followups: [{ id: "f_1" }] }), { status: 200 }));
    const response = await onRequestGet(context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, followups: [{ id: "f_1" }] });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/owned-followups?state=open&limit=50",
      expect.objectContaining({ headers: { Authorization: "Bearer worker-secret" } }),
    );
  });

  it("attributes a create to the authenticated staff member", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, followup: { id: "f_1" } }), { status: 201 }));
    const response = await onRequestPost(context("POST", {
      action: "create", contactId: "ghl_1", title: "Call tomorrow", dueOn: "2026-08-09",
    }));
    expect(response.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/owned-followups",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer worker-secret",
          "Content-Type": "application/json",
          "X-Staff-Actor": "Eben",
        },
      }),
    );
  });

  it("fails closed when the worker credential is not configured", async () => {
    const response = await onRequestGet(context("GET", null, {}));
    expect(response.status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
