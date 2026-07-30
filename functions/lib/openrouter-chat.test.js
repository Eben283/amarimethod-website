import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openRouterChat, DEFAULT_OPENROUTER_FREE_MODEL } from "./openrouter-chat.js";

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
    expect(res.model).toBe(DEFAULT_OPENROUTER_FREE_MODEL);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    const body = JSON.parse(init.body);
    expect(body.model).toContain(":free");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
  });
});
