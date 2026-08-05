import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/endpoint-guards.js", () => ({
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

vi.mock("../../lib/ops-auth.js", () => ({
  requireOpsReadKey: vi.fn((request, env) => {
    if (!env.OPS_READ_KEY) return new Response("unconfigured", { status: 503 });
    if (request.headers.get("X-Service-Key") !== env.OPS_READ_KEY) {
      return new Response("unauthorized", { status: 401 });
    }
    return null;
  }),
}));

vi.mock("../../lib/ops-events.js", () => ({
  listOpsIncidents: vi.fn(async () => [{ id: "incident-1", pathId: "crm_mirror" }]),
}));

import { onRequestGet } from "./incidents.js";
import { listOpsIncidents } from "../../lib/ops-events.js";

function ctx({ key, configured = true } = {}) {
  return {
    env: { AUTOMATION_DB: {}, OPS_READ_KEY: configured ? "ops-secret" : undefined },
    request: {
      url: "https://www.amarimethod.com/api/ops/incidents",
      headers: { get: (name) => name === "X-Service-Key" ? key || null : null },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/ops/incidents", () => {
  it("fails closed when service auth is unconfigured or invalid", async () => {
    expect((await onRequestGet(ctx({ configured: false }))).status).toBe(503);
    expect((await onRequestGet(ctx())).status).toBe(401);
    expect((await onRequestGet(ctx({ key: "wrong" }))).status).toBe(401);
    expect(listOpsIncidents).not.toHaveBeenCalled();
  });

  it("returns incidents for the Ops service key", async () => {
    const response = await onRequestGet(ctx({ key: "ops-secret" }));
    expect(response.status).toBe(200);
    expect((await response.json()).incidents).toHaveLength(1);
    expect(listOpsIncidents).toHaveBeenCalled();
  });
});
