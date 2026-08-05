import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/endpoint-guards.js", () => ({
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
  requireStaffAuth: vi.fn(async (context, headers) => {
    const user = context.request.headers.get("X-Test-User");
    if (user) return { payload: { role: "staff", user } };
    return {
      error: new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers,
      }),
    };
  }),
}));

vi.mock("../../lib/worker-auth.js", () => ({
  requireWorkerAuth: vi.fn((request, env) => {
    const h = request.headers.get("Authorization") || "";
    if (h === `Bearer ${env.WORKER_AUTH_SECRET}`) return null;
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }),
}));

vi.mock("../../lib/ops-board.js", () => ({
  buildSystemsBoard: vi.fn(async () => ({ systems: [] })),
  buildPathDetail: vi.fn(async (_env, pathId) =>
    pathId === "assessment_paid_book"
      ? { id: pathId, label: "Assessment", state: "sick", changeSurface: { touch: "x" } }
      : null,
  ),
}));

vi.mock("../../lib/ops-fix.js", () => ({
  isAutoFixable: vi.fn((id) => id === "assessment_paid_book"),
  launchFixForPath: vi.fn(async () => ({ ok: true, job: { status: "shadow" } })),
  queueFixRequest: vi.fn(async (_env, pathId) =>
    pathId === "assessment_paid_book"
      ? { queued: true, request: { pathId } }
      : { queued: false, reason: "not-fixable" },
  ),
  readFixJob: vi.fn(async () => null),
  runOpsFixSweep: vi.fn(async () => ({ mode: "shadow", launched: [] })),
}));

import { onRequestGet, onRequestPost } from "./fix.js";
import { buildPathDetail } from "../../lib/ops-board.js";
import {
  queueFixRequest,
  readFixJob,
  runOpsFixSweep,
  launchFixForPath,
} from "../../lib/ops-fix.js";

beforeEach(() => {
  vi.clearAllMocks();
});

function ctx(url, { method = "GET", body, auth, user = "Eben" } = {}) {
  const headers = {
    get(name) {
      if (name === "Origin") return null;
      if (name === "Authorization") return auth || null;
      if (name === "X-Test-User") return user || null;
      return null;
    },
  };
  return {
    env: { WORKER_AUTH_SECRET: "secret", OPS_FIX_MODE: "shadow" },
    request: {
      url,
      method,
      headers,
      async json() {
        return body || {};
      },
    },
  };
}

describe("GET /api/ops/fix", () => {
  it("rejects an unauthenticated job-status read", async () => {
    const res = await onRequestGet(ctx(
      "https://www.amarimethod.com/api/ops/fix?pathId=assessment_paid_book",
      { user: null },
    ));
    expect(res.status).toBe(401);
    expect(readFixJob).not.toHaveBeenCalled();
  });

  it("requires pathId", async () => {
    const res = await onRequestGet(ctx("https://www.amarimethod.com/api/ops/fix"));
    expect(res.status).toBe(400);
  });

  it("returns job status", async () => {
    const res = await onRequestGet(
      ctx("https://www.amarimethod.com/api/ops/fix?pathId=assessment_paid_book"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.autoFix).toBe(true);
    expect(data.fixMode).toBe("shadow");
  });
});

describe("POST /api/ops/fix", () => {
  it("rejects unauthenticated browser repair requests before mutation", async () => {
    const request = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "request", pathId: "assessment_paid_book" },
        user: null,
      }),
    );
    const fix = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "fix", pathId: "assessment_paid_book" },
        user: null,
      }),
    );
    expect(request.status).toBe(401);
    expect(fix.status).toBe(401);
    expect(queueFixRequest).not.toHaveBeenCalled();
    expect(buildPathDetail).not.toHaveBeenCalled();
    expect(launchFixForPath).not.toHaveBeenCalled();
  });

  it("does not accept the worker bearer secret for browser repair actions", async () => {
    const res = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "fix", pathId: "assessment_paid_book" },
        auth: "Bearer secret",
        user: null,
      }),
    );
    expect(res.status).toBe(401);
    expect(buildPathDetail).not.toHaveBeenCalled();
    expect(launchFixForPath).not.toHaveBeenCalled();
  });

  it("queues a Staff-authenticated request", async () => {
    const res = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "request", pathId: "assessment_paid_book" },
      }),
    );
    expect(res.status).toBe(200);
    expect(queueFixRequest).toHaveBeenCalled();
  });

  it("fix action launches manually with Staff auth and cannot force cooldown bypass", async () => {
    launchFixForPath.mockResolvedValueOnce({
      ok: true,
      promptReady: true,
      prompt: "fix me",
      job: { status: "prompt_ready" },
    });
    const res = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "fix", pathId: "assessment_paid_book" },
      }),
    );
    expect(res.status).toBe(200);
    expect(launchFixForPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "assessment_paid_book" }),
      expect.objectContaining({ manual: true, requested: true, force: false }),
    );
    const data = await res.json();
    expect(data.promptReady).toBe(true);
  });

  it("sweep requires worker auth even with a valid Staff session", async () => {
    const denied = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "sweep" },
        user: "Eben",
      }),
    );
    expect(denied.status).toBe(401);

    const ok = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "sweep" },
        auth: "Bearer secret",
        user: null,
      }),
    );
    expect(ok.status).toBe(200);
    expect(runOpsFixSweep).toHaveBeenCalled();
  });

  it("launch requires worker auth", async () => {
    const res = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "launch", pathId: "assessment_paid_book" },
        auth: "Bearer secret",
        user: null,
      }),
    );
    expect(res.status).toBe(200);
    expect(launchFixForPath).toHaveBeenCalled();
  });
});
