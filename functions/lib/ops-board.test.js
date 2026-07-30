import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ops-events.js", () => ({
  countOpenIncidentsByPath: vi.fn(async () => ({})),
  listOpsIncidents: vi.fn(async () => []),
  listOpsEvents: vi.fn(async () => []),
}));

vi.mock("./ops-alert.js", () => ({
  listOpsErrors: vi.fn(async () => []),
}));

vi.mock("./ops-trail-kv.js", () => ({
  trailMeta: vi.fn(async () => null),
}));

import { buildSystemsBoard, buildPathDetail } from "./ops-board.js";
import {
  countOpenIncidentsByPath,
  listOpsIncidents,
  listOpsEvents,
} from "./ops-events.js";
import { listOpsErrors } from "./ops-alert.js";
import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";

beforeEach(() => {
  vi.clearAllMocks();
  listOpsEvents.mockResolvedValue([]);
  listOpsErrors.mockResolvedValue([]);
});

function kvEnv(map = {}) {
  return {
    PORTAL_KV: {
      async get(key, type) {
        const v = map[key];
        if (v == null) return null;
        if (type === "json") return typeof v === "string" ? JSON.parse(v) : v;
        return String(v);
      },
    },
  };
}

describe("buildSystemsBoard", () => {
  it("marks assessment red when an open incident exists; paths before deps", async () => {
    countOpenIncidentsByPath.mockResolvedValue({ [PATH_ASSESSMENT_PAID_BOOK]: 1 });
    const board = await buildSystemsBoard({ AUTOMATION_DB: {}, ...kvEnv() });
    expect(board.overall).toBe("red");
    const assessment = board.systems.find((s) => s.id === PATH_ASSESSMENT_PAID_BOOK);
    expect(assessment.status).toBe("red");
    expect(board.systems[0].group).toBe("paths");
  });

  it("does not fake-green assessment with empty trail", async () => {
    countOpenIncidentsByPath.mockResolvedValue({});
    const board = await buildSystemsBoard({ AUTOMATION_DB: {}, ...kvEnv() });
    const assessment = board.systems.find((s) => s.id === PATH_ASSESSMENT_PAID_BOOK);
    expect(assessment.status).toBe("unknown");
    expect(assessment.note).toMatch(/no trail/i);
  });

  it("marks partial paths unknown, never green, unless ops:err", async () => {
    const board = await buildSystemsBoard({ AUTOMATION_DB: {}, ...kvEnv() });
    const intro = board.systems.find((s) => s.id === "intro_paid_book");
    expect(intro.status).toBe("unknown");
  });

  it("marks invoice credit red from recent ops:err", async () => {
    listOpsErrors.mockResolvedValue([
      {
        key: "ops:err:1",
        source: "ghl-invoice-webhook",
        summary: "PUT sessions failed",
        at: new Date().toISOString(),
      },
    ]);
    const board = await buildSystemsBoard(kvEnv());
    const invoice = board.systems.find((s) => s.id === "invoice_package_credit");
    expect(invoice.status).toBe("red");
    expect(invoice.note).toMatch(/failure/i);
  });

  it("registers expanded money/booking/messaging/infra rows", async () => {
    const board = await buildSystemsBoard(kvEnv());
    const ids = board.systems.map((s) => s.id);
    for (const id of [
      "invoice_package_credit",
      "order_package_credit",
      "discovery_free_book",
      "portal_package_book",
      "appointment_webhook",
      "comms_coherence",
      "reminder_engine",
      "conversation_cache",
      "funnel_refresh",
      "call_coach",
      "ledger_drift",
      "field_id_check",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("surfaces live GHL token + reconcile + funnel signals", async () => {
    const expiry = String(Date.now() + 20 * 3600 * 1000);
    const board = await buildSystemsBoard(
      kvEnv({
        ghl_token_expiry: expiry,
        "ops:series-reconcile:lastRun": {
          status: "ok",
          finishedAt: new Date().toISOString(),
          applied: 0,
          ordersScanned: 7,
        },
        "ops:funnel-refresh:lastRun": {
          status: "ok",
          finishedAt: new Date().toISOString(),
          sales: 3,
          sessionsSold: 8,
        },
      }),
    );
    expect(board.systems.find((s) => s.id === "ghl_token").status).toBe("green");
    expect(board.systems.find((s) => s.id === "series_reconcile").status).toBe("green");
    expect(board.systems.find((s) => s.id === "funnel_refresh").status).toBe("green");
  });
});

describe("buildPathDetail", () => {
  it("returns null for unknown path", async () => {
    expect(await buildPathDetail({}, "nope")).toBeNull();
  });

  it("highlights failed hop and returns log", async () => {
    listOpsIncidents.mockResolvedValue([
      {
        id: "inc_1",
        title: "Paid Assessment, no appointment",
        failedHopId: "create_appointment",
        personLabel: "Holly Brinkman",
      },
    ]);
    listOpsEvents.mockResolvedValue([
      {
        hopId: "create_appointment",
        outcome: "fail",
        summary: "no book",
        at: "2026-07-29T12:00:00.000Z",
        condition: { expected: "slot iso", observed: "null" },
      },
      {
        hopId: "purchase_webhook",
        outcome: "ok",
        summary: "paid",
        at: "2026-07-29T11:59:00.000Z",
      },
    ]);
    const detail = await buildPathDetail({ AUTOMATION_DB: {} }, PATH_ASSESSMENT_PAID_BOOK);
    expect(detail.status).toBe("red");
    const bookHop = detail.hops.find((h) => h.id === "create_appointment");
    expect(bookHop.state).toBe("red");
    expect(detail.events).toHaveLength(2);
    expect(detail.incidents[0].personLabel).toBe("Holly Brinkman");
  });

  it("dependency detail exposes why from KV signal", async () => {
    const expiry = String(Date.now() + 12 * 3600 * 1000);
    const detail = await buildPathDetail(kvEnv({ ghl_token_expiry: expiry }), "ghl_token");
    expect(detail.status).toBe("green");
    expect(detail.why).toMatch(/remaining/i);
    expect(detail.events.length).toBeGreaterThan(0);
  });
});
