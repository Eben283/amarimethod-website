import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchWithRetry } from "./fetch-retry.js";

// Build a global.fetch stub that plays a scripted sequence of handlers, one per
// attempt. Each handler gets (url, options) and returns a Promise<Response>.
function scriptFetch(handlers) {
  let calls = 0;
  const stub = (url, options) => {
    const h = handlers[Math.min(calls, handlers.length - 1)];
    calls++;
    return h(url, options);
  };
  Object.defineProperty(stub, "calls", { get: () => calls });
  vi.stubGlobal("fetch", stub);
  return stub;
}

const ok = (body = "ok") => () => Promise.resolve(new Response(body, { status: 200 }));
const status = (code) => () => Promise.resolve(new Response("", { status: code }));
const netFail = (msg = "network down") => () => Promise.reject(new Error(msg));
// Hangs forever until fetchWithRetry's AbortController fires — models a stall.
const hangUntilAbort = () => (_url, { signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
  });

const FAST = { attempts: 3, timeoutMs: 20, baseDelayMs: 1 };

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithRetry", () => {
  it("returns immediately on a 2xx (one call, no retry)", async () => {
    const f = scriptFetch([ok("hello")]);
    const res = await fetchWithRetry("https://x", {}, FAST);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(f.calls).toBe(1);
  });

  it("does NOT retry a non-retryable 4xx (404 returns immediately)", async () => {
    const f = scriptFetch([status(404), ok()]);
    const res = await fetchWithRetry("https://x", {}, FAST);
    expect(res.status).toBe(404);
    expect(f.calls).toBe(1);
  });

  it("retries a 429 then succeeds", async () => {
    const f = scriptFetch([status(429), ok("recovered")]);
    const res = await fetchWithRetry("https://x", {}, FAST);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("recovered");
    expect(f.calls).toBe(2);
  });

  it("retries a 5xx (503) then succeeds", async () => {
    const f = scriptFetch([status(503), status(502), ok()]);
    const res = await fetchWithRetry("https://x", {}, FAST);
    expect(res.status).toBe(200);
    expect(f.calls).toBe(3);
  });

  it("retries a network error then succeeds", async () => {
    const f = scriptFetch([netFail(), ok("back")]);
    const res = await fetchWithRetry("https://x", {}, FAST);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("back");
    expect(f.calls).toBe(2);
  });

  it("aborts a hung call at the per-attempt timeout, then succeeds on retry", async () => {
    const f = scriptFetch([hangUntilAbort(), ok("unstuck")]);
    const res = await fetchWithRetry("https://x", {}, FAST);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("unstuck");
    expect(f.calls).toBe(2);
  });

  it("returns the last retryable Response when all attempts stay 429 (does not throw)", async () => {
    const f = scriptFetch([status(429), status(429), status(429)]);
    const res = await fetchWithRetry("https://x", {}, FAST);
    expect(res.status).toBe(429);
    expect(f.calls).toBe(3);
  });

  it("throws when every attempt is a network error", async () => {
    scriptFetch([netFail("boom"), netFail("boom"), netFail("boom")]);
    await expect(fetchWithRetry("https://x", {}, FAST)).rejects.toThrow("boom");
  });
});
