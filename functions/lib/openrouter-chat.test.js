import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openRouterChat, DEFAULT_OPENROUTER_MODEL } from "./openrouter-chat.js";

describe("openRouterChat", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("errors when OPENROUTER_API_KEY missing", async () => {
    const res = await openRouterChat({}, { user: "hi" });
    expect(res.error).toMatch(/OPENROUTER_API_KEY/);
  });

  it("posts OpenAI-compatible body to OpenRouter and returns text", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '{"flags":[]}' } }] };
      },
      async text() {
        return "";
      },
    }));
    const res = await openRouterChat(
      { OPENROUTER_API_KEY: "sk-or-test" },
      { system: "sys", user: "hello", maxTokens: 100 },
    );
    expect(res.text).toBe('{"flags":[]}');
    expect(res.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
  });

  it("falls back to the next model on 429", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        async text() {
          return "rate limited";
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: "ok-from-fallback" } }] };
        },
        async text() {
          return "";
        },
      });
    const res = await openRouterChat(
      { OPENROUTER_API_KEY: "sk-or-test", OPENROUTER_MODEL: "google/gemma-4-31b-it:free" },
      { user: "hello" },
    );
    expect(res.text).toBe("ok-from-fallback");
    expect(res.model).toBe("google/gemini-2.5-flash-lite");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
