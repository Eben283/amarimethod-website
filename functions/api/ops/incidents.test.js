import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/endpoint-guards.js", () => ({
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
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
    const unconfigured = await onRequestGet(ctx({ configured: false }));
    const missing = await onRequestGet(ctx());
    const wrong = await onRequestGet(ctx({ key: "wrong" }));
    expect(unconfigured.status).toBe(500);
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unconfigured.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(missing.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(wrong.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(listOpsIncidents).not.toHaveBeenCalled();
  });

  it("returns incidents for the Ops service key", async () => {
    const response = await onRequestGet(ctx({ key: "ops-secret" }));
    expect(response.status).toBe(200);
    expect((await response.json()).incidents).toHaveLength(1);
    expect(listOpsIncidents).toHaveBeenCalled();
  });
});
