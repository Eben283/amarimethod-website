import { describe, expect, it } from "vitest";
import { anthropicUserError, COS_CALENDAR_IDS, resolveCosLlm } from "./cos-anthropic.js";

describe("anthropicUserError", () => {
  it("maps Anthropic credit-balance failures to a billing message", () => {
    const mapped = anthropicUserError(
      new Error(
        'Anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
      ),
    );
    expect(mapped.billing).toBe(true);
    expect(mapped.code).toBe("anthropic_credits");
    expect(mapped.message).toMatch(/credits are exhausted/i);
  });

  it("maps auth failures without leaking the raw body", () => {
    const mapped = anthropicUserError(new Error("Anthropic 401: invalid x-api-key"));
    expect(mapped.code).toBe("anthropic_auth");
    expect(mapped.message).toMatch(/API key/i);
    expect(mapped.message).not.toMatch(/invalid x-api-key/);
  });

  it("falls back to a connection message for unknown stream failures", () => {
    const mapped = anthropicUserError(new Error("network reset"));
    expect(mapped.code).toBe("stream_interrupted");
    expect(mapped.billing).toBe(false);
  });
});

describe("resolveCosLlm", () => {
  it("prefers the OpenRouter Chief of Staff key", () => {
    const llm = resolveCosLlm({
      OPENROUTER_API_KEY: "sk-or-v1-test",
      ANTHROPIC_API_KEY: "sk-ant-should-not-win",
    });
    expect(llm.provider).toBe("openrouter");
    expect(llm.apiKey).toBe("sk-or-v1-test");
    expect(llm.url).toContain("openrouter.ai");
    expect(llm.model).toMatch(/claude-sonnet-4/);
  });

  it("falls back to direct Anthropic when OpenRouter is unset", () => {
    const llm = resolveCosLlm({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(llm.provider).toBe("anthropic");
    expect(llm.url).toContain("api.anthropic.com");
  });

  it("returns null when neither key is set", () => {
    expect(resolveCosLlm({})).toBeNull();
  });
});

describe("COS_CALENDAR_IDS", () => {
  it("includes the Amari Assessment calendar so day summaries do not omit it", () => {
    expect(COS_CALENDAR_IDS).toContain("EM6vB2mq7EAdGCbUb3j1");
  });
});
