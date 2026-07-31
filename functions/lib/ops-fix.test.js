import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildFixPrompt,
  isAutoFixable,
  queueFixRequest,
  launchFixForPath,
  runOpsFixSweep,
  OPS_FIX_MODES,
  __test,
} from "./ops-fix.js";
import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

function kvEnv(map = {}, extras = {}) {
  const store = { ...map };
  return {
    PORTAL_KV: {
      async get(key, type) {
        const v = store[key];
        if (v == null) return null;
        if (type === "json") return typeof v === "string" ? JSON.parse(v) : v;
        return String(v);
      },
      async put(key, value) {
        store[key] = value;
      },
      async delete(key) {
        delete store[key];
      },
      async list({ prefix, cursor } = {}) {
        const keys = Object.keys(store)
          .filter((k) => !prefix || k.startsWith(prefix))
          .map((name) => ({ name }));
        return { keys, list_complete: true, cursor };
      },
    },
    _store: store,
    ...extras,
  };
}

describe("isAutoFixable", () => {
  it("allows assessment; blocks stripe / staff_auth / ghl_token", () => {
    expect(isAutoFixable(PATH_ASSESSMENT_PAID_BOOK)).toBe(true);
    expect(isAutoFixable("stripe")).toBe(false);
    expect(isAutoFixable("staff_auth")).toBe(false);
    expect(isAutoFixable("ghl_token")).toBe(false);
  });
});

describe("buildFixPrompt", () => {
  it("names path, change surface, and stop-on-secrets rule", () => {
    const prompt = buildFixPrompt({
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      label: "Assessment paid → book",
      state: "sick",
      note: "open incident",
      why: "create_appointment failed",
      requested: true,
      events: [{ at: "2026-07-30T12:00:00Z", hopId: "create_appointment", outcome: "fail", summary: "no appt" }],
    });
    expect(prompt).toContain(PATH_ASSESSMENT_PAID_BOOK);
    expect(prompt).toMatch(/Change surface/i);
    expect(prompt).toMatch(/secrets\/config/i);
    expect(prompt).toMatch(/manual request/i);
    expect(prompt).toContain("create_appointment");
  });
});

describe("queueFixRequest", () => {
  it("queues fixable paths and rejects unknown / not-fixable", async () => {
    const env = kvEnv();
    const ok = await queueFixRequest(env, PATH_ASSESSMENT_PAID_BOOK);
    expect(ok.queued).toBe(true);
    expect(env._store[`ops:fix:request:${PATH_ASSESSMENT_PAID_BOOK}`]).toBeTruthy();

    expect((await queueFixRequest(env, "nope_path")).reason).toBe("unknown-path");
    expect((await queueFixRequest(env, "stripe")).reason).toBe("not-fixable");
  });

  it("blocks queue when a job is already active", async () => {
    const env = kvEnv({
      [`ops:fix:job:${PATH_ASSESSMENT_PAID_BOOK}`]: JSON.stringify({
        pathId: PATH_ASSESSMENT_PAID_BOOK,
        status: "launched",
        launchedAt: new Date().toISOString(),
      }),
    });
    const res = await queueFixRequest(env, PATH_ASSESSMENT_PAID_BOOK);
    expect(res.queued).toBe(false);
    expect(res.reason).toBe("already-running");
  });
});

describe("launchFixForPath", () => {
  it("shadow mode writes would_launch job without calling Cursor", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const env = kvEnv({}, { OPS_FIX_MODE: OPS_FIX_MODES.SHADOW });
    const res = await launchFixForPath(env, {
      id: PATH_ASSESSMENT_PAID_BOOK,
      label: "Assessment",
      state: "sick",
      note: "red",
    });
    expect(res.ok).toBe(true);
    expect(res.shadowed).toBe(true);
    expect(res.job.status).toBe("shadow");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("auto mode posts to Cursor v1 agents", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          agent: { id: "bc-test", url: "https://cursor.com/agents/bc-test" },
          run: { id: "run-1" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const env = kvEnv(
      {},
      { OPS_FIX_MODE: OPS_FIX_MODES.AUTO, CURSOR_API_KEY: "test-key" },
    );
    const res = await launchFixForPath(env, {
      id: PATH_ASSESSMENT_PAID_BOOK,
      label: "Assessment",
      state: "stuck",
    });
    expect(res.ok).toBe(true);
    expect(res.job.agentId).toBe("bc-test");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.cursor.com/v1/agents");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.autoCreatePR).toBe(true);
    expect(body.prompt.text).toContain(PATH_ASSESSMENT_PAID_BOOK);
  });

  it("manual Fix without API key returns copy-paste prompt", async () => {
    const env = kvEnv({}, { OPS_FIX_MODE: OPS_FIX_MODES.SHADOW });
    const res = await launchFixForPath(
      env,
      { id: PATH_ASSESSMENT_PAID_BOOK, label: "Assessment", state: "sick" },
      { manual: true },
    );
    expect(res.ok).toBe(true);
    expect(res.promptReady).toBe(true);
    expect(res.prompt).toContain(PATH_ASSESSMENT_PAID_BOOK);
    expect(res.job.status).toBe("prompt_ready");
  });

  it("manual Fix with API key launches even when cron mode is shadow", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ agent: { id: "bc-manual", url: "https://cursor.com/agents/bc-manual" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const env = kvEnv(
      {},
      { OPS_FIX_MODE: OPS_FIX_MODES.SHADOW, CURSOR_API_KEY: "test-key" },
    );
    const res = await launchFixForPath(
      env,
      { id: PATH_ASSESSMENT_PAID_BOOK, state: "sick" },
      { manual: true },
    );
    expect(res.ok).toBe(true);
    expect(res.job.agentId).toBe("bc-manual");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("respects cooldown", async () => {
    const env = kvEnv(
      {
        [`ops:fix:job:${PATH_ASSESSMENT_PAID_BOOK}`]: JSON.stringify({
          pathId: PATH_ASSESSMENT_PAID_BOOK,
          status: "launched",
          launchedAt: new Date().toISOString(),
        }),
      },
      { OPS_FIX_MODE: OPS_FIX_MODES.SHADOW },
    );
    const res = await launchFixForPath(env, {
      id: PATH_ASSESSMENT_PAID_BOOK,
      state: "sick",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("cooldown");
  });
});

describe("runOpsFixSweep", () => {
  it("launches for attention autoFix rows", async () => {
    const env = kvEnv({}, { OPS_FIX_MODE: OPS_FIX_MODES.SHADOW });
    const board = {
      systems: [
        {
          id: PATH_ASSESSMENT_PAID_BOOK,
          label: "Assessment",
          state: "sick",
          note: "open",
          autoFix: true,
        },
        { id: "stripe", label: "Stripe", state: "map_bad", autoFix: false },
      ],
    };
    const summary = await runOpsFixSweep(env, {
      buildSystemsBoard: async () => board,
    });
    expect(summary.mode).toBe("shadow");
    expect(summary.considered).toContain(PATH_ASSESSMENT_PAID_BOOK);
    expect(summary.launched.some((l) => l.pathId === PATH_ASSESSMENT_PAID_BOOK)).toBe(true);
    expect(summary.considered).not.toContain("stripe");
  });

  it("picks up queued requests even when not in attention", async () => {
    const env = kvEnv(
      {
        [`ops:fix:request:${PATH_ASSESSMENT_PAID_BOOK}`]: JSON.stringify({
          pathId: PATH_ASSESSMENT_PAID_BOOK,
          requestedAt: new Date().toISOString(),
        }),
      },
      { OPS_FIX_MODE: OPS_FIX_MODES.SHADOW },
    );
    const board = {
      systems: [
        {
          id: PATH_ASSESSMENT_PAID_BOOK,
          label: "Assessment",
          state: "healthy",
          autoFix: true,
        },
      ],
    };
    const summary = await runOpsFixSweep(env, {
      buildSystemsBoard: async () => board,
    });
    expect(summary.considered).toContain(PATH_ASSESSMENT_PAID_BOOK);
    expect(summary.launched.length).toBe(1);
  });
});

describe("helpers", () => {
  it("modeOf defaults to shadow", () => {
    expect(__test.modeOf({})).toBe("shadow");
    expect(__test.modeOf({ OPS_FIX_MODE: "auto" })).toBe("auto");
    expect(__test.modeOf({ OPS_FIX_MODE: "weird" })).toBe("shadow");
  });
});
