import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../lib/cos-anthropic.js", () => ({
  OPENROUTER_MODEL: "anthropic/claude-sonnet-4.6",
  probeOpenRouter: vi.fn(),
}));

import { onRequestGet } from "./cos-health.js";
import { probeOpenRouter } from "../lib/cos-anthropic.js";

afterEach(() => vi.clearAllMocks());

function context(env = {}) {
  return {
    request: new Request("https://www.amarimethod.com/api/cos-health", { headers: { "X-Service-Key": "ops-key" } }),
    env: {
      OPS_READ_KEY: "ops-key",
      PORTAL_KV: { put: vi.fn() },
      ...env,
    },
  };
}

describe("GET /api/cos-health", () => {
  it("runs a protected OpenRouter probe and stores green readiness", async () => {
    probeOpenRouter.mockResolvedValue({ model: "anthropic/claude-sonnet-4.6" });
    const ctx = context({ OPENROUTER_API_KEY: "sk-or-test" });
    const response = await onRequestGet(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, provider: "openrouter" });
    expect(probeOpenRouter).toHaveBeenCalledWith("sk-or-test");
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith("cos:status:ready", expect.any(String), expect.any(Object));
  });

  it("records and returns a failed readiness state when OpenRouter is unavailable", async () => {
    probeOpenRouter.mockRejectedValue(new Error("OpenRouter 401 readiness probe failed"));
    const ctx = context({ OPENROUTER_API_KEY: "sk-or-test" });
    const response = await onRequestGet(ctx);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, error: "OpenRouter 401 readiness probe failed" });
  });

  it("does not expose the endpoint without the ops key", async () => {
    const response = await onRequestGet({ request: new Request("https://www.amarimethod.com/api/cos-health"), env: {} });
    expect(response.status).toBe(503);
    expect(probeOpenRouter).not.toHaveBeenCalled();
  });
});
