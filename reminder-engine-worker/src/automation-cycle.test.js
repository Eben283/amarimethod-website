import { describe, expect, it, vi } from "vitest";
import { runAutomationCycle } from "./automation-cycle.js";

describe("runAutomationCycle", () => {
  it("runs due sends, provider receipts, and paid-booking recovery in order", async () => {
    const order = [];
    const runSweep = vi.fn(async () => { order.push("send"); return { sent: 2 }; });
    const reconcileDeliveryReceipts = vi.fn(async () => { order.push("receipt"); return { checked: 2, recorded: 2, pending: 0, errors: 0 }; });
    const reconcilePaidBookingIntents = vi.fn(async () => { order.push("paid-booking"); return { checked: 1, recovered: 1, waitingForPayment: 0, manualReview: 0, errors: 0 }; });
    const result = await runAutomationCycle({}, 1234, { runSweep, reconcileDeliveryReceipts, reconcilePaidBookingIntents });
    expect(order).toEqual(["send", "receipt", "paid-booking"]);
    expect(result).toEqual({
      sends: { sent: 2 },
      receipts: { checked: 2, recorded: 2, pending: 0, errors: 0 },
      paidBookings: { checked: 1, recovered: 1, waitingForPayment: 0, manualReview: 0, errors: 0 },
    });
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
      paidBookings: { checked: 0, recovered: 0, waitingForPayment: 0, manualReview: 0, errors: 0, skipped: "not-configured" },
    });
  });

  it("contains a paid-booking recovery failure without stopping reminder work", async () => {
    const result = await runAutomationCycle({}, 1234, {
      runSweep: vi.fn(async () => ({ sent: 1 })),
      reconcileDeliveryReceipts: vi.fn(async () => ({ checked: 0, recorded: 0, pending: 0, errors: 0 })),
      reconcilePaidBookingIntents: vi.fn(async () => { throw new Error("attendance database unavailable"); }),
    });
    expect(result.paidBookings).toEqual(expect.objectContaining({ errors: 1, fatal: "attendance database unavailable" }));
  });
});
