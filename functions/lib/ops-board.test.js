import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ops-events.js", () => ({
  countOpenIncidentsByPath: vi.fn(async () => ({})),
  listOpsIncidents: vi.fn(async () => []),
  listOpsEvents: vi.fn(async () => []),
}));

import { buildSystemsBoard, buildPathDetail } from "./ops-board.js";
import {
  countOpenIncidentsByPath,
  listOpsIncidents,
  listOpsEvents,
} from "./ops-events.js";
import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSystemsBoard", () => {
  it("marks assessment red when an open incident exists; paths before deps", async () => {
    countOpenIncidentsByPath.mockResolvedValue({ [PATH_ASSESSMENT_PAID_BOOK]: 1 });
    const board = await buildSystemsBoard({ AUTOMATION_DB: {} });
    expect(board.overall).toBe("red");
    const assessment = board.systems.find((s) => s.id === PATH_ASSESSMENT_PAID_BOOK);
    expect(assessment.status).toBe("red");
    expect(board.systems[0].kind).toBe("path");
  });

  it("assessment green when watching and no open incidents", async () => {
    countOpenIncidentsByPath.mockResolvedValue({});
    const board = await buildSystemsBoard({ AUTOMATION_DB: {} });
    const assessment = board.systems.find((s) => s.id === PATH_ASSESSMENT_PAID_BOOK);
    expect(assessment.status).toBe("green");
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
});
