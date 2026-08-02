import { describe, expect, it, vi, afterEach } from "vitest";
import { buildRequestBody, callOpenRouter, OPENROUTER_MODEL, probeOpenRouter } from "./cos-anthropic.js";

afterEach(() => vi.restoreAllMocks());

describe("COS OpenRouter transport", () => {
  it("uses OpenRouter's Anthropic Messages endpoint and a bearer key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await callOpenRouter("sk-or-test", { model: OPENROUTER_MODEL, messages: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/messages",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk-or-test" }) }),
    );
  });

  it("qualifies the current Sonnet model for OpenRouter", () => {
    expect(buildRequestBody({ system: "system", messages: [{ role: "user", content: "hello" }], includeTools: false }).model)
      .toBe("anthropic/claude-sonnet-4.6");
  });

  it("fails the readiness probe on a provider error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(probeOpenRouter("sk-or-test")).rejects.toThrow("OpenRouter 401 readiness probe failed");
  });
});
