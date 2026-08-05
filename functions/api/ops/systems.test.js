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

vi.mock("../../lib/ops-board.js", () => ({
  buildSystemsBoard: vi.fn(async () => ({
    overall: "green",
    attentionCount: 0,
    hotStrip: { tone: "healthy", headline: "quiet", people: [] },
    systems: [{ id: "assessment_paid_book", status: "green", state: "healthy" }],
    generatedAt: "t",
    configured: true,
  })),
  buildPathDetail: vi.fn(async (_env, pathId) =>
    pathId === "assessment_paid_book"
      ? { id: pathId, status: "red", state: "stuck", hops: [], events: [], incidents: [], people: [] }
      : null,
  ),
  buildPersonTimeline: vi.fn(async (_env, { pathId, contactId }) =>
    pathId === "assessment_paid_book" && contactId === "c_holly"
      ? {
          view: "person",
          pathId,
          personLabel: "Holly Brinkman",
          contactId,
          site: [],
          automation: [],
          why: "Stuck",
          nextIfUnchanged: "No confirmation",
        }
      : null,
  ),
}));

import { onRequestGet } from "./systems.js";
import {
  buildSystemsBoard,
  buildPathDetail,
  buildPersonTimeline,
} from "../../lib/ops-board.js";

beforeEach(() => {
  vi.clearAllMocks();
});

function ctx(url, user = "Eben") {
  return {
    env: { AUTOMATION_DB: {} },
    request: {
      url,
      headers: { get: (name) => name === "X-Test-User" ? user : null },
    },
  };
}

describe("GET /api/ops/systems", () => {
  it("rejects an unauthenticated request before reading Operations data", async () => {
    const res = await onRequestGet(ctx("https://www.amarimethod.com/api/ops/systems", null));
    expect(res.status).toBe(401);
    expect(buildSystemsBoard).not.toHaveBeenCalled();
    expect(buildPathDetail).not.toHaveBeenCalled();
    expect(buildPersonTimeline).not.toHaveBeenCalled();
  });

  it("accepts Garrett's separately authenticated Staff session", async () => {
    const res = await onRequestGet(ctx("https://www.amarimethod.com/api/ops/systems", "Garrett"));
    expect(res.status).toBe(200);
    expect(buildSystemsBoard).toHaveBeenCalled();
  });

  it("allows Garrett's separately authenticated path and person reads", async () => {
    const path = await onRequestGet(ctx(
      "https://www.amarimethod.com/api/ops/systems?pathId=assessment_paid_book",
      "Garrett",
    ));
    const person = await onRequestGet(ctx(
      "https://www.amarimethod.com/api/ops/systems?pathId=assessment_paid_book&contactId=c_holly",
      "Garrett",
    ));
    expect(path.status).toBe(200);
    expect(person.status).toBe(200);
    expect(buildPathDetail).toHaveBeenCalled();
    expect(buildPersonTimeline).toHaveBeenCalled();
  });

  it("returns the board for Eben's Staff session", async () => {
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

  it("returns person timeline when pathId + contactId set", async () => {
    const res = await onRequestGet(
      ctx(
        "https://www.amarimethod.com/api/ops/systems?pathId=assessment_paid_book&contactId=c_holly",
      ),
    );
    expect(res.status).toBe(200);
    expect(buildPersonTimeline).toHaveBeenCalled();
    const body = await res.json();
    expect(body.view).toBe("person");
    expect(body.personLabel).toBe("Holly Brinkman");
  });

  it("404 for unknown person", async () => {
    const res = await onRequestGet(
      ctx(
        "https://www.amarimethod.com/api/ops/systems?pathId=assessment_paid_book&contactId=missing",
      ),
    );
    expect(res.status).toBe(404);
  });

  it("404 for unknown pathId", async () => {
    const res = await onRequestGet(
      ctx("https://www.amarimethod.com/api/ops/systems?pathId=missing"),
    );
    expect(res.status).toBe(404);
  });
});
