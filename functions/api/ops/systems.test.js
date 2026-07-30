import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/endpoint-guards.js", () => ({
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
  requireStaffAuth: vi.fn(),
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
import { requireStaffAuth } from "../../lib/endpoint-guards.js";
import { buildSystemsBoard, buildPathDetail } from "../../lib/ops-board.js";

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffAuth.mockResolvedValue({ payload: { user: "Garrett", role: "staff" } });
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
  it("401 when auth fails", async () => {
    requireStaffAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    });
    const res = await onRequestGet(ctx("https://www.amarimethod.com/api/ops/systems"));
    expect(res.status).toBe(401);
    expect(buildSystemsBoard).not.toHaveBeenCalled();
  });

  it("returns board for any staff user", async () => {
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
