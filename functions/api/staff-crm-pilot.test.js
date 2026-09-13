import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

import { requireStaffAuth } from "../lib/endpoint-guards.js";
import { onRequestGet } from "./staff-crm-pilot.js";

function context(url, env = { WORKER_AUTH_SECRET: "worker-secret" }) {
  return {
    env,
    request: new Request(url, { headers: { Origin: "https://www.amarimethod.com" } }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe("private Staff CRM pilot reads", () => {
  it("requires Staff authentication before contacting the CRM mirror", async () => {
    requireStaffAuth.mockResolvedValue({ error: new Response("denied", { status: 401 }) });
    const response = await onRequestGet(context("https://www.amarimethod.com/api/staff-crm-pilot?view=inbox"));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reads the complete owned inbox through the server-side worker credential", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ threads: [{ contact_id: "owned_1" }] }) });
    const response = await onRequestGet(context("https://www.amarimethod.com/api/staff-crm-pilot?view=inbox&query=Robin&limit=5000"));
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/communications/inbox?limit=1000&query=Robin",
      expect.objectContaining({ headers: { Authorization: "Bearer worker-secret", "X-Staff-Actor": "Eben" } }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("worker-secret");
  });

  it("reads one bounded contact record and rejects malformed identities", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Garrett" } });
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ contact: { id: "owned_123" } }) });
    const response = await onRequestGet(context("https://www.amarimethod.com/api/staff-crm-pilot?view=contact&id=owned_123&limit=900"));
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/client-desk/contacts/owned_123?limit=250",
      expect.objectContaining({ headers: { Authorization: "Bearer worker-secret", "X-Staff-Actor": "Garrett" } }),
    );

    const invalid = await onRequestGet(context("https://www.amarimethod.com/api/staff-crm-pilot?view=contact&id=../secret"));
    expect(invalid.status).toBe(400);
  });

  it("fails closed when the worker credential is unavailable", async () => {
    requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
    const response = await onRequestGet(context("https://www.amarimethod.com/api/staff-crm-pilot?view=inbox", {}));
    expect(response.status).toBe(422);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
