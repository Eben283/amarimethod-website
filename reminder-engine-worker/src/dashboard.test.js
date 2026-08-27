import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));
vi.mock("../../functions/lib/ghl-worker-token.js", () => ({ getAccessToken: vi.fn().mockResolvedValue("tok") }));

import { compareShadowEvents, DASHBOARD_HTML, handleDashboardData } from "./dashboard.js";

const KEY = "dash-key-123";

// Read-only fake D1 for the dashboard queries.
function fakeD1(seed = {}) {
  const t = {
    automation_events: seed.events || [],
    reminder_enrollments: seed.rem || [],
    nurture_enrollments: seed.nur || [],
    reminder_steps: seed.remSteps || [],
    nurture_steps: seed.nurSteps || [],
  };
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async all() {
      if (/FROM automation_events WHERE outcome IN/.test(sql)) {
        return { results: t.automation_events.filter((e) => ["failed", "bounced", "error"].includes(e.outcome)) };
      }
      if (/FROM automation_events/.test(sql)) {
        const [since] = this._args;
        return { results: t.automation_events.filter((e) => e.ts >= since) };
      }
      if (/FROM reminder_enrollments WHERE status='active'/.test(sql) && /UNION/.test(sql)) {
        return {
          results: [
            ...t.reminder_enrollments.map((r) => ({ engine: "reminder", key: r.flow_key, contact_id: r.contact_id })),
            ...t.nurture_enrollments.map((r) => ({ engine: "nurture", key: r.sequence_id, contact_id: r.contact_id })),
          ],
        };
      }
      if (/s\.due_at <= \?/.test(sql)) return { results: t.reminder_steps.concat(t.nurture_steps) };
      return { results: [] };
    },
  });
  return { prepare };
}

const req = (auth) =>
  new Request("https://x.example/dashboard-data?hours=48", {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });

let env;
beforeEach(() => {
  env = {
    DASHBOARD_KEY: KEY,
    REMINDER_DB: fakeD1({
      events: [{ id: 1, ts: Date.now(), engine: "nurture", flow_key: "flow-1-quiz", contact_id: "c1", action: "enrolled", outcome: "enrolled", detail: '{"steps":6}' }],
      nur: [{ sequence_id: "flow-1-quiz", contact_id: "c1" }],
    }),
    // no PORTAL_KV → name enrichment skipped
  };
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /dashboard shell", () => {
  it("is a self-contained page with no data baked in", () => {
    expect(DASHBOARD_HTML).toContain("<title>");
    expect(DASHBOARD_HTML).toContain("Operations");
    expect(DASHBOARD_HTML).not.toContain("flow-1-quiz"); // data arrives only via the gated endpoint
    expect(DASHBOARD_HTML).not.toMatch(/https?:\/\/(?!reminder-engine|amarimethod\.com|www\.amarimethod\.com)[a-z]/); // no external resources
  });

  it("uses the signed Staff session before asking for a manually stored key", () => {
    expect(DASHBOARD_HTML).toContain("function requestData(key)");
    expect(DASHBOARD_HTML).toContain('var headers = key ? { Authorization: "Bearer " + key } : {};');
    expect(DASHBOARD_HTML).toContain('headers["X-Amari-Automation-Dashboard-Session"] = dashboardSession;');
    expect(DASHBOARD_HTML).toContain('var options = { headers: headers, credentials: "same-origin" };');
    expect(DASHBOARD_HTML).not.toContain("if (!key) { gate.hidden = false; app.hidden = true; return; }");
  });
});

describe("compareShadowEvents", () => {
  it("labels matched, late, missing, and early GHL sends without treating unavailable data as missing", () => {
    const now = Date.now();
    const events = [
      { id: 1, ts: now, contact_id: "matched", flow_key: "flow", channel: "email", outcome: "would_send", detail: { template: "a" } },
      { id: 2, ts: now, contact_id: "late", flow_key: "flow", channel: "sms", outcome: "would_send", detail: { template: "b" } },
      { id: 3, ts: now, contact_id: "missing", flow_key: "flow", channel: "email", outcome: "would_send", detail: { template: "c" } },
      { id: 4, ts: now, contact_id: "early", flow_key: "flow", channel: "email", outcome: "would_send", detail: { template: "d" } },
      { id: 5, ts: now, contact_id: "unavailable", flow_key: "flow", channel: "sms", outcome: "would_send", detail: { template: "e" } },
      { id: 6, ts: now, contact_id: "internal", flow_key: "flow", channel: "sms", outcome: "would_send", detail: { template: "booked-internal" } },
    ];
    const comparison = compareShadowEvents(events, {
      available: true,
      unavailableContactIds: ["unavailable"],
      messagesByContact: {
        matched: [{ id: "m1", at: now + 5 * 60_000, channel: "email" }],
        late: [{ id: "m2", at: now + 60 * 60_000, channel: "sms" }],
        early: [{ id: "m3", at: now - 60 * 60_000, channel: "email" }],
      },
    });
    expect(comparison.rows.map((row) => row.status)).toEqual(["matched", "late", "missing_in_ghl", "extra_in_ghl", "unavailable"]);
    expect(comparison.compared).toBe(5);
    expect(comparison.summary).toMatchObject({ matched: 1, late: 1, missing_in_ghl: 1, extra_in_ghl: 1, unavailable: 1 });
  });
});

describe("GET /dashboard-data — gated by the dedicated read-only key", () => {
  it("503s when no key is configured (fail closed)", async () => {
    const res = await handleDashboardData(req(KEY), { REMINDER_DB: fakeD1() });
    expect(res.status).toBe(503);
  });

  it("401s a missing or wrong key before any query", async () => {
    for (const r of [req(null), req("wrong")]) {
      expect((await handleDashboardData(r, env)).status).toBe(401);
    }
  });

  it("returns the four panels for a valid key", async () => {
    const res = await handleDashboardData(req(KEY), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].detail).toEqual({ steps: 6 });
    expect(body.enrollments).toEqual([expect.objectContaining({ engine: "nurture", key: "flow-1-quiz" })]);
    expect(body).toHaveProperty("dueSoon");
    expect(body).toHaveProperty("failures");
    expect(body.comparison).toMatchObject({ compared: 0, summary: { matched: 0 } });
    expect(body).toHaveProperty("generatedAt");
  });

  it("never throws on a broken DB — 500 with a JSON error", async () => {
    const res = await handleDashboardData(req(KEY), { DASHBOARD_KEY: KEY, REMINDER_DB: { prepare: () => { throw new Error("d1 down"); } } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/d1 down/);
  });
});
