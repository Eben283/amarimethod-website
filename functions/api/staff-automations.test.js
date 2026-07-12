import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth guard so the tests pin the endpoint's wiring: denied → guard's response wins
// and the DB is never touched; allowed → views are served.
vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(),
  corsHeaders: () => ({}),
}));

import { onRequestGet } from "./staff-automations.js";
import { requireStaffAuth } from "../lib/endpoint-guards.js";

const deny = () => ({ error: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) });
const allow = () => ({ error: null, payload: { role: "staff" } });

function makeContext(query, env = {}) {
  return {
    request: new Request(`https://x.example/api/staff-automations?${query}`, { headers: {} }),
    env,
  };
}

// Empty-but-valid D1: every query returns no rows.
const emptyDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };

beforeEach(() => vi.clearAllMocks());

describe("staff-automations — auth gate", () => {
  it("an unauthenticated request gets the guard's 401 and never touches the DB", async () => {
    requireStaffAuth.mockResolvedValue(deny());
    const db = { prepare: vi.fn() };
    const res = await onRequestGet(makeContext("view=contact&contactId=abc", { AUTOMATION_DB: db }));
    expect(res.status).toBe(401);
    expect(db.prepare).not.toHaveBeenCalled();
  });
});

describe("staff-automations — views", () => {
  beforeEach(() => requireStaffAuth.mockResolvedValue(allow()));

  it("no AUTOMATION_DB binding → 200 configured:false (honest empty state, not an error)", async () => {
    const res = await onRequestGet(makeContext("view=contact&contactId=abc", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, configured: false });
  });

  it("contact view: validates contactId (400 on junk, no query)", async () => {
    const db = { prepare: vi.fn() };
    for (const q of ["view=contact", "view=contact&contactId=", "view=contact&contactId=a b", "view=contact&contactId=<script>"]) {
      const res = await onRequestGet(makeContext(q, { AUTOMATION_DB: db }));
      expect(res.status).toBe(400);
    }
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("contact view: returns the normalized view for a valid id", async () => {
    const res = await onRequestGet(makeContext("view=contact&contactId=cont1", { AUTOMATION_DB: emptyDb }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      success: true, configured: true, contactId: "cont1",
      enrollments: [], events: [], upgradeOffer: null,
    }));
  });

  it("failures view: serves the window with a clamped sinceHours", async () => {
    const res = await onRequestGet(makeContext("view=failures&sinceHours=99999", { AUTOMATION_DB: emptyDb }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sinceHours).toBe(24 * 90); // clamped to 90 days
    expect(body.failures).toEqual([]);
  });

  it("unknown view → 400; a query failure → 500 with a JSON body (never a bare throw)", async () => {
    expect((await onRequestGet(makeContext("view=nope", { AUTOMATION_DB: emptyDb }))).status).toBe(400);
    const broken = { prepare: () => { throw new Error("d1 down"); } };
    const res = await onRequestGet(makeContext("view=failures", { AUTOMATION_DB: broken }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/d1 down/);
  });
});
