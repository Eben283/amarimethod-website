import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.amarimethod.com" }),
  parseJsonBody: async (request, headers) => {
    try {
      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { error: new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers }) };
      }
      return { body };
    } catch {
      return { error: new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }) };
    }
  },
  requireStaffAuth: vi.fn(),
}));

vi.mock("../lib/ops-ledger.js", () => ({
  readOperationsLedger: vi.fn(),
  ingestOperationsLedgerTask: vi.fn(),
  ingestOperationsLedgerEvent: vi.fn(),
  ingestOperationsLedgerRelease: vi.fn(),
}), { virtual: true });

import { requireStaffAuth } from "../lib/endpoint-guards.js";
import {
  readOperationsLedger,
  ingestOperationsLedgerTask,
  ingestOperationsLedgerEvent,
  ingestOperationsLedgerRelease,
} from "../lib/ops-ledger.js";
import { onRequestGet, onRequestPost } from "./staff-operations-ledger.js";

function context(url, { method = "GET", body, headers = {}, env = {} } = {}) {
  return {
    request: new Request(`https://www.amarimethod.com${url}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  };
}

function mockD1() {
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ all: vi.fn(), first: vi.fn() })) })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Garrett" } });
  readOperationsLedger.mockResolvedValue({
    configured: true,
    entries: [{ id: "e1", eventType: "booking", summary: "Appointment accepted", contactName: "SHOULD NOT LEAK", rawPayload: { email: "person@example.test" } }],
    tasks: [{ id: "t1", title: "Review booking", personLabel: "SHOULD NOT LEAK" }],
    releases: [{ id: "r1", version: "2026.08.26", commitSha: "abc123", payload: { phone: "+14155551212" } }],
    incidents: [{ id: "i1", status: "open", title: "Booking path attention", contactId: "provider-contact" }],
    nextCursor: "next-page",
  });
});

describe("staff-operations-ledger read route", () => {
  it("requires Staff auth before touching the ledger", async () => {
    const denied = new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    requireStaffAuth.mockResolvedValue({ error: denied });
    const response = await onRequestGet(context("/api/staff-operations-ledger", { env: { AUTOMATION_DB: { prepare: vi.fn() } } }));
    expect(response.status).toBe(401);
    expect(readOperationsLedger).not.toHaveBeenCalled();
  });

  it("passes bounded pagination and filters and returns all four safe collections", async () => {
    const db = mockD1();
    const response = await onRequestGet(context("/api/staff-operations-ledger?limit=1000&cursor=abc&status=open&source=worker&q=booking", {
      env: { AUTOMATION_DB: db },
    }));
    expect(response.status).toBe(200);
    expect(readOperationsLedger).toHaveBeenCalledWith(expect.objectContaining({ AUTOMATION_DB: db }), {
      resource: "all",
      limit: 100,
      cursor: "abc",
      filters: { status: "open", source: "worker", q: "booking" },
    });
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({
      success: true,
      configured: true,
      nextCursor: "next-page",
      entries: [{ id: "e1", eventType: "booking", summary: "Appointment accepted" }],
      tasks: [{ id: "t1", title: "Review booking" }],
      releases: [{ id: "r1", version: "2026.08.26", commitSha: "abc123" }],
      incidents: [{ id: "i1", status: "open", title: "Booking path attention" }],
    }));
    expect(JSON.stringify(body)).not.toContain("SHOULD NOT LEAK");
    expect(JSON.stringify(body)).not.toContain("provider-contact");
    expect(JSON.stringify(body)).not.toContain("person@example.test");
  });

  it("allows one filtered resource and rejects unknown resources", async () => {
    const one = await onRequestGet(context("/api/staff-operations-ledger?resource=incidents&limit=5"));
    expect(one.status).toBe(200);
    const oneBody = await one.json();
    expect(oneBody.incidents).toHaveLength(1);
    expect(oneBody.entries).toBeUndefined();

    const invalid = await onRequestGet(context("/api/staff-operations-ledger?resource=raw"));
    expect(invalid.status).toBe(400);
    expect(readOperationsLedger).toHaveBeenCalledOnce();
  });
});

describe("staff-operations-ledger service ingest", () => {
  const auth = { OPS_LEDGER_INGEST_KEY: "ingest-secret" };

  it("fails closed when the ingest key is not configured or is wrong", async () => {
    const absent = await onRequestPost(context("/api/staff-operations-ledger?resource=tasks", { method: "POST", body: { title: "x" } }));
    expect(absent.status).toBe(500);
    const wrong = await onRequestPost(context("/api/staff-operations-ledger?resource=tasks", {
      method: "POST", body: { title: "x" }, env: auth, headers: { OPS_LEDGER_INGEST_KEY: "wrong" },
    }));
    expect(wrong.status).toBe(401);
    expect(ingestOperationsLedgerTask).not.toHaveBeenCalled();
  });

  it.each([
    ["tasks", ingestOperationsLedgerTask, { id: "t1", title: "Review", actor: "Evil", rawPayload: { name: "person" } }],
    ["events", ingestOperationsLedgerEvent, { id: "e1", type: "booking", summary: "Accepted", user: "Evil", payload: { email: "person@example.test" } }],
    ["releases", ingestOperationsLedgerRelease, { id: "r1", version: "v1", source: "worker", createdBy: "Evil", metadata: { phone: "+14155551212" } }],
  ])("writes %s only with fixed service provenance and no caller actor/raw payload", async (resource, ingest, body) => {
    ingest.mockResolvedValue({ id: body.id, status: "accepted", actor: "service", payload: { email: "should not return" } });
    const response = await onRequestPost(context(`/api/staff-operations-ledger?resource=${resource}`, {
      method: "POST", body, env: auth, headers: { OPS_LEDGER_INGEST_KEY: "ingest-secret" },
    }));
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(auth, expect.not.objectContaining({ actor: "Evil", user: "Evil", createdBy: "Evil", payload: expect.anything() }), {
      principal: { kind: "worker", id: "ops-ledger-ingest" },
      source: "staff-operations-ledger-service",
    });
    const output = await response.json();
    expect(JSON.stringify(output)).not.toContain("should not return");
    expect(JSON.stringify(output)).not.toContain("Evil");
  });

  it("does not expose an open writer without an explicit resource", async () => {
    const response = await onRequestPost(context("/api/staff-operations-ledger", {
      method: "POST", body: { title: "x" }, env: auth, headers: { OPS_LEDGER_INGEST_KEY: "ingest-secret" },
    }));
    expect(response.status).toBe(400);
    expect(ingestOperationsLedgerTask).not.toHaveBeenCalled();
  });
});
