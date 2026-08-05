import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../../lib/ops-events.js", () => ({
  recordOpsEvent: vi.fn(async () => ({ recorded: true, id: "evt_monitor" })),
  openOpsIncident: vi.fn(async () => ({ opened: true, id: "inc_monitor" })),
  resolveOpsIncident: vi.fn(async () => ({ resolved: 1 })),
}));

import { onRequestPost } from "./monitor-event.js";
import { openOpsIncident, recordOpsEvent, resolveOpsIncident } from "../../lib/ops-events.js";

afterEach(() => vi.clearAllMocks());

function context(body, env = {}) {
  return {
    request: new Request("https://www.amarimethod.com/api/ops/monitor-event", {
      method: "POST",
      headers: { "X-Service-Key": "ops-key", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env: { OPS_READ_KEY: "ops-key", ...env },
  };
}

describe("POST /api/ops/monitor-event", () => {
  it("records a failed independent check and opens a correlated incident", async () => {
    const response = await onRequestPost(context({
      pathId: "chief_of_staff",
      state: "red",
      note: "OpenRouter readiness probe failed",
      observedAt: "2026-08-02T00:00:00.000Z",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: "opened" });
    expect(recordOpsEvent).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      pathId: "chief_of_staff",
      hopId: "synthetic_monitor",
      outcome: "fail",
      correlationId: "monitor:chief_of_staff",
    }));
    expect(openOpsIncident).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      pathId: "chief_of_staff",
      correlationId: "monitor:chief_of_staff",
      failedHopId: "synthetic_monitor",
    }), expect.any(Object));
  });

  it("records recovery and closes only that monitor incident", async () => {
    const response = await onRequestPost(context({
      pathId: "chief_of_staff",
      state: "green",
      note: "OpenRouter ready",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: "resolved" });
    expect(recordOpsEvent).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ outcome: "ok" }));
    expect(resolveOpsIncident).toHaveBeenCalledWith(expect.any(Object), {
      pathId: "chief_of_staff",
      correlationId: "monitor:chief_of_staff",
    });
    expect(openOpsIncident).not.toHaveBeenCalled();
  });

  it("fails closed for invalid or unregistered monitor reports", async () => {
    const response = await onRequestPost(context({ pathId: "not-a-system", state: "red" }));
    expect(response.status).toBe(400);
    expect(recordOpsEvent).not.toHaveBeenCalled();
  });

  it("rejects registered paths the external monitor does not own", async () => {
    const res = await onRequestPost(context({
      pathId: "assessment_paid_book",
      state: "red",
      note: "forged customer path signal",
    }));
    expect(res.status).toBe(400);
    expect(recordOpsEvent).not.toHaveBeenCalled();
    expect(openOpsIncident).not.toHaveBeenCalled();
  });

  it("rejects invalid or materially future observation timestamps", async () => {
    const invalid = await onRequestPost(context({
      pathId: "github_actions",
      state: "green",
      observedAt: "not-a-time",
    }));
    const future = await onRequestPost(context({
      pathId: "github_actions",
      state: "green",
      observedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }));
    expect(invalid.status).toBe(400);
    expect(future.status).toBe(400);
    expect(recordOpsEvent).not.toHaveBeenCalled();
    expect(resolveOpsIncident).not.toHaveBeenCalled();
  });

  it("records a healthy refresh as a heartbeat rather than a recovery", async () => {
    const response = await onRequestPost(context({
      pathId: "ops_monitor",
      state: "green",
      note: "all critical paths checked",
      heartbeat: true,
    }));
    expect(response.status).toBe(200);
    expect(recordOpsEvent).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      pathId: "ops_monitor",
      outcome: "ok",
      reasonCode: "monitor_heartbeat",
      summary: expect.stringMatching(/heartbeat/i),
    }));
  });
});
