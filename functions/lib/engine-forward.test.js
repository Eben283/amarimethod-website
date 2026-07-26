import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forwardEventToEngine, emitNurtureEvent } from "./engine-forward.js";

const event = { kind: "quiz.submitted", contactId: "cont_1" };

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, actions: [{ engine: "nurture", action: "enroll" }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("forwardEventToEngine — POST a typed event to a worker's /event route", () => {
  const env = { NURTURE_ENGINE_URL: "https://nurture-engine.example.workers.dev", WORKER_AUTH_SECRET: "s3cret" };

  it("posts JSON to <url>/event with the bearer secret and returns the worker's actions", async () => {
    const res = await forwardEventToEngine(env, { urlVar: "NURTURE_ENGINE_URL", event });
    expect(res).toEqual({ ok: true, actions: [{ engine: "nurture", action: "enroll" }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://nurture-engine.example.workers.dev/event");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body)).toEqual(event);
  });

  it("skips cleanly when the URL or the secret is unconfigured (pre-deploy state)", async () => {
    expect(await forwardEventToEngine({}, { urlVar: "NURTURE_ENGINE_URL", event })).toEqual({ ok: true, skipped: "unconfigured" });
    expect(await forwardEventToEngine({ NURTURE_ENGINE_URL: "https://x" }, { urlVar: "NURTURE_ENGINE_URL", event })).toEqual({ ok: true, skipped: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a non-200 from the worker is ok:false with the status, never a throw", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const res = await forwardEventToEngine(env, { urlVar: "NURTURE_ENGINE_URL", event });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/401/);
  });

  it("a network failure is contained", async () => {
    fetchMock.mockRejectedValue(new Error("connect timeout"));
    const res = await forwardEventToEngine(env, { urlVar: "NURTURE_ENGINE_URL", event });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/connect timeout/);
  });
});

describe("emitNurtureEvent — the fire-and-forget emitter for quiz/purchase events", () => {
  it("rides context.waitUntil so the caller's response is never delayed", () => {
    const waitUntil = vi.fn();
    const context = { env: { NURTURE_ENGINE_URL: "https://x.workers.dev", WORKER_AUTH_SECRET: "s" }, waitUntil };
    emitNurtureEvent(context, event);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("never throws, even without waitUntil or env", () => {
    expect(() => emitNurtureEvent({ env: {} }, event)).not.toThrow();
    expect(() => emitNurtureEvent(undefined, event)).not.toThrow();
  });
});
