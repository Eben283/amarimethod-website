import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/endpoint-guards.js", () => ({
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
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
import { queueFixRequest, runOpsFixSweep, launchFixForPath } from "../../lib/ops-fix.js";

beforeEach(() => {
  vi.clearAllMocks();
});

function ctx(url, { method = "GET", body, auth } = {}) {
  const headers = {
    get(name) {
      if (name === "Origin") return null;
      if (name === "Authorization") return auth || null;
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
  it("queues a public request", async () => {
    const res = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "request", pathId: "assessment_paid_book" },
      }),
    );
    expect(res.status).toBe(200);
    expect(queueFixRequest).toHaveBeenCalled();
  });

  it("sweep requires worker auth", async () => {
    const denied = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "sweep" },
      }),
    );
    expect(denied.status).toBe(401);

    const ok = await onRequestPost(
      ctx("https://www.amarimethod.com/api/ops/fix", {
        method: "POST",
        body: { action: "sweep" },
        auth: "Bearer secret",
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
      }),
    );
    expect(res.status).toBe(200);
    expect(launchFixForPath).toHaveBeenCalled();
  });
});
