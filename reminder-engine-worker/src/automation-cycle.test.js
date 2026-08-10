import { describe, expect, it, vi } from "vitest";
import { runAutomationCycle } from "./automation-cycle.js";

describe("runAutomationCycle", () => {
  it("runs due sends before reconciling provider receipts", async () => {
    const order = [];
    const runSweep = vi.fn(async () => { order.push("send"); return { sent: 2 }; });
    const reconcileDeliveryReceipts = vi.fn(async () => { order.push("receipt"); return { checked: 2, recorded: 2, pending: 0, errors: 0 }; });
    const result = await runAutomationCycle({}, 1234, { runSweep, reconcileDeliveryReceipts });
    expect(order).toEqual(["send", "receipt"]);
    expect(result).toEqual({ sends: { sent: 2 }, receipts: { checked: 2, recorded: 2, pending: 0, errors: 0 } });
  });

  it("still reconciles receipts when the send sweep fails", async () => {
    const reconcileDeliveryReceipts = vi.fn(async () => ({ checked: 1, recorded: 1, pending: 0, errors: 0 }));
    const result = await runAutomationCycle({}, 1234, {
      runSweep: vi.fn(async () => { throw new Error("send store unavailable"); }),
      reconcileDeliveryReceipts,
    });
    expect(reconcileDeliveryReceipts).toHaveBeenCalledOnce();
    expect(result).toEqual({
      sends: { errors: 1, fatal: "send store unavailable" },
      receipts: { checked: 1, recorded: 1, pending: 0, errors: 0 },
    });
  });
});
