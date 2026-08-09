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

  it("no AUTOMATION_DB binding → 200 configured:false with explicit execution gaps", async () => {
    const res = await onRequestGet(makeContext("view=contact&contactId=abc", {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      success: true,
      configured: false,
      contactId: "abc",
      enrollments: [],
      events: [],
    }));
    expect(body.evidence.gaps.map((gap) => gap.code)).toContain("execution_store_unavailable");
  });

  it("registry view is available without D1 and exposes versioned owned definitions", async () => {
    const res = await onRequestGet(makeContext("view=registry", {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.registryVersion).toBe(1);
    expect(body.definitions).toHaveLength(7);
    expect(body.definitions[0]).toEqual(expect.objectContaining({
      id: "reminder:initial-in-person",
      definitionVersion: 2,
      source: { kind: "owned_code", path: "reminder-engine-worker/src/config.js" },
      messagePreview: expect.objectContaining({ status: "source_verified_read_only" }),
      cutoverReadiness: expect.objectContaining({ status: "not_eligible" }),
    }));
  });

  it("families view exposes the condensed lifecycle registry and preserves the 82-record evidence count", async () => {
    const res = await onRequestGet(makeContext("view=families", {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual(expect.objectContaining({
      operationalFamilies: 24,
      evidenceOnlyGroups: 1,
      sourceRecords: 82,
      publishedSourceRecords: 64,
      draftSourceRecords: 18,
      ownedDefinitions: 7,
    }));
    expect(body.families).toHaveLength(25);
    expect(body.evidence.gaps.map((gap) => gap.code)).toContain("external_canvas_history_not_imported");
  });

  it("family view joins exact definitions and owned execution evidence without requiring D1", async () => {
    const res = await onRequestGet(makeContext("view=family&key=initial-session-reminders", {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.family).toEqual(expect.objectContaining({
      key: "initial-session-reminders",
      ownedDefinitions: expect.arrayContaining([
        expect.objectContaining({ id: "reminder:initial-in-person" }),
        expect.objectContaining({ id: "reminder:initial-virtual" }),
      ]),
    }));
    expect(body.enrollments).toEqual([]);
    expect(body.events).toEqual([]);
  });

  it("partner family view presents the shadow definition and read-only message copy", async () => {
    const res = await onRequestGet(makeContext("view=family&key=partner-session-lifecycle", {}));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.family).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ ownedDefinitions: 1 }),
      ownedDefinitions: [expect.objectContaining({
        id: "reminder:partner-initial-in-person",
        mode: "shadow",
        messagePreview: expect.objectContaining({
          status: "source_verified_read_only",
          notices: expect.arrayContaining([
            expect.objectContaining({ subject: "Your partner session is confirmed" }),
          ]),
        }),
        cutoverReadiness: expect.objectContaining({
          status: "not_eligible",
          requirements: expect.arrayContaining([
            expect.objectContaining({ code: "no_show_series_exit_not_owned", status: "blocked" }),
          ]),
        }),
      })],
    }));
  });

  it("family view reads global execution evidence through the CRM worker when Pages has no D1 binding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      configured: true,
      familyKey: "initial-session-reminders",
      enrollments: [{ enrollmentId: "enrollment_1", status: "active" }],
      events: [{ id: "event_1", outcome: "would_send" }],
      coverage: { enrollmentsTruncated: false, eventsTruncated: false },
      evidence: { source: "owned_automation_d1", gaps: [] },
    }), { status: 200 })));

    const res = await onRequestGet(makeContext(
      "view=family&key=initial-session-reminders",
      { WORKER_AUTH_SECRET: "worker-secret" },
    ));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.enrollments).toHaveLength(1);
    expect(body.events).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/automations/families/initial-session-reminders"), expect.objectContaining({
      headers: { Authorization: "Bearer worker-secret" },
    }));
    vi.unstubAllGlobals();
  });

  it("family view validates keys and returns 404 for a missing family", async () => {
    expect((await onRequestGet(makeContext("view=family&key=<script>", {}))).status).toBe(400);
    expect((await onRequestGet(makeContext("view=family&key=missing", {}))).status).toBe(404);
  });

  it("automation view joins one definition to owned execution evidence", async () => {
    const res = await onRequestGet(makeContext(
      "view=automation&engine=reminder&key=initial-in-person",
      { AUTOMATION_DB: emptyDb },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      success: true,
      configured: true,
      definition: expect.objectContaining({ id: "reminder:initial-in-person" }),
      enrollments: [],
      events: [],
    }));
    expect(body.evidence.executionSource).toBe("owned_d1_append_only_log");
  });

  it("automation view validates engine/key and returns 404 for an unregistered definition", async () => {
    expect((await onRequestGet(makeContext("view=automation&engine=bad&key=x", {}))).status).toBe(400);
    expect((await onRequestGet(makeContext("view=automation&engine=reminder&key=missing", {}))).status).toBe(404);
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

  it("contact view stays keyed by the owned person and joins the server-derived provider crosswalk", async () => {
    const queries = [];
    const db = {
      prepare: (sql) => ({ bind: (...values) => ({ all: async () => { queries.push({ sql, values }); return { results: [] }; } }) }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      contacts: [{ id: "owned_person_1", provider_contact_id: "legacy_ghl_1" }],
    }), { status: 200 })));

    const res = await onRequestGet(makeContext(
      "view=contact&contactId=owned_person_1",
      { AUTOMATION_DB: db, WORKER_AUTH_SECRET: "worker-secret" },
    ));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      contactId: "owned_person_1",
      providerContactId: "legacy_ghl_1",
      automationContactIds: ["owned_person_1", "legacy_ghl_1"],
    }));
    expect(queries.some((query) => query.values.includes("owned_person_1"))).toBe(true);
    expect(queries.some((query) => query.values.includes("legacy_ghl_1"))).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("query=owned_person_1"), expect.objectContaining({
      headers: { Authorization: "Bearer worker-secret" },
    }));
    vi.unstubAllGlobals();
  });

  it("contact view resolves a legacy provider route id to the owned person before reading evidence", async () => {
    const queries = [];
    const db = {
      prepare: (sql) => ({ bind: (...values) => ({ all: async () => { queries.push({ sql, values }); return { results: [] }; } }) }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      contacts: [{ id: "owned_person_1", provider_contact_id: "legacy_ghl_1" }],
    }), { status: 200 })));

    const res = await onRequestGet(makeContext(
      "view=contact&contactId=legacy_ghl_1",
      { AUTOMATION_DB: db, WORKER_AUTH_SECRET: "worker-secret" },
    ));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      contactId: "owned_person_1",
      providerContactId: "legacy_ghl_1",
      automationContactIds: ["owned_person_1", "legacy_ghl_1"],
    }));
    expect(queries.some((query) => query.values.includes("owned_person_1"))).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("query=legacy_ghl_1"), expect.any(Object));
    vi.unstubAllGlobals();
  });

  it("contact view supports an owned-only person without inventing former-provider history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      contacts: [{ id: "owned_person_2", provider_contact_id: null }],
    }), { status: 200 })));
    const res = await onRequestGet(makeContext(
      "view=contact&contactId=owned_person_2",
      { AUTOMATION_DB: emptyDb, WORKER_AUTH_SECRET: "worker-secret" },
    ));
    const body = await res.json();
    expect(body.contactId).toBe("owned_person_2");
    expect(body.automationContactIds).toEqual(["owned_person_2"]);
    expect(body.evidence.gaps.map((gap) => gap.code)).toContain("provider_identity_not_applicable");
    vi.unstubAllGlobals();
  });

  it("contact view reads person evidence through the owned CRM worker when Pages has no D1 binding", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        contacts: [{ id: "owned_person_1", provider_contact_id: "legacy_ghl_1" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        configured: true,
        contactId: "owned_person_1",
        providerContactId: "legacy_ghl_1",
        automationContactIds: ["owned_person_1", "legacy_ghl_1"],
        enrollments: [{ enrollmentId: "enrollment_1", status: "active" }],
        events: [],
        coverage: { eventLimit: 200, eventsTruncated: false },
        evidence: { source: "owned_automation_d1", gaps: [] },
      }), { status: 200 })));

    const res = await onRequestGet(makeContext(
      "view=contact&contactId=owned_person_1",
      { WORKER_AUTH_SECRET: "worker-secret" },
    ));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.contactId).toBe("owned_person_1");
    expect(body.enrollments).toHaveLength(1);
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining("/automations/people/owned_person_1"), expect.objectContaining({
      headers: { Authorization: "Bearer worker-secret" },
    }));
    vi.unstubAllGlobals();
  });

  it("activity view: serves the today/yesterday feed with a 48h default window", async () => {
    const res = await onRequestGet(makeContext("view=activity", { AUTOMATION_DB: emptyDb }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sinceHours).toBe(48);
    expect(body.events).toEqual([]);
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
