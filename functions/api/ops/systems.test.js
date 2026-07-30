import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/endpoint-guards.js", () => ({
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
  requireEbenStaffAuth: vi.fn(),
}));

vi.mock("../../lib/ops-board.js", () => ({
  buildSystemsBoard: vi.fn(async () => ({
    overall: "green",
    systems: [{ id: "assessment_paid_book", status: "green" }],
    generatedAt: "t",
    configured: true,
  })),
  buildPathDetail: vi.fn(async (_env, pathId) =>
    pathId === "assessment_paid_book"
      ? { id: pathId, status: "red", hops: [], events: [], incidents: [] }
      : null,
  ),
}));

import { onRequestGet } from "./systems.js";
import { requireEbenStaffAuth } from "../../lib/endpoint-guards.js";
import { buildSystemsBoard, buildPathDetail } from "../../lib/ops-board.js";

beforeEach(() => {
  vi.clearAllMocks();
  requireEbenStaffAuth.mockResolvedValue({ payload: { user: "Eben", role: "staff" } });
});

function ctx(url) {
  return {
    env: { AUTOMATION_DB: {} },
    request: {
      url,
      headers: { get: () => null },
    },
  };
}

describe("GET /api/ops/systems", () => {
  it("401/403 when auth fails", async () => {
    requireEbenStaffAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Amari Ops is Eben-only" }), { status: 403 }),
    });
    const res = await onRequestGet(ctx("https://www.amarimethod.com/api/ops/systems"));
    expect(res.status).toBe(403);
    expect(buildSystemsBoard).not.toHaveBeenCalled();
  });

  it("returns board for Eben", async () => {
    const res = await onRequestGet(ctx("https://www.amarimethod.com/api/ops/systems"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall).toBe("green");
    expect(buildSystemsBoard).toHaveBeenCalled();
  });

  it("returns path detail when pathId set", async () => {
    const res = await onRequestGet(
      ctx("https://www.amarimethod.com/api/ops/systems?pathId=assessment_paid_book"),
    );
    expect(res.status).toBe(200);
    expect(buildPathDetail).toHaveBeenCalled();
    expect((await res.json()).id).toBe("assessment_paid_book");
  });

  it("404 for unknown pathId", async () => {
    const res = await onRequestGet(
      ctx("https://www.amarimethod.com/api/ops/systems?pathId=missing"),
    );
    expect(res.status).toBe(404);
  });
});
