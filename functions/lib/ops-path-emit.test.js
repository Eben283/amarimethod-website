import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ops-events.js", () => ({
  recordOpsEvent: vi.fn(async (env, evt) => ({ recorded: true, id: `evt_${evt.hopId}` })),
  openOpsIncident: vi.fn(async () => ({ opened: true })),
  resolveOpsIncident: vi.fn(async () => ({ resolved: true })),
}));

vi.mock("./ops-alert.js", () => ({
  recordOpsError: vi.fn(async () => ({ recorded: true })),
}));

import { recordOpsEvent } from "./ops-events.js";
import {
  emitPathHop,
  paidBookPathForProduct,
  recordPaidBookPath,
} from "./ops-path-emit.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS } from "./ops-last-run.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("paidBookPathForProduct", () => {
  it("maps follow-up product to portal path and initials to intro", () => {
    expect(
      paidBookPathForProduct("6998ace59dfde469ecb2aab6", { isNativePaidBooking: true }),
    ).toBe("portal_followup_paid_book");
    expect(
      paidBookPathForProduct("688a1cd770362828afbf08a2", { isNativePaidBooking: true }),
    ).toBe("intro_paid_book");
    expect(
      paidBookPathForProduct("x", { isNativePaidBooking: true, isNonCreditBooking: true }),
    ).toBe(null);
  });
});

describe("emitPathHop / recordPaidBookPath", () => {
  it("emits a hop", async () => {
    await emitPathHop({}, {
      pathId: "discovery_free_book",
      hopId: "submit",
      outcome: "ok",
      summary: "ok",
      source: "book/create-checkout:discovery",
    });
    expect(recordOpsEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ pathId: "discovery_free_book", hopId: "submit" }),
    );
  });

  it("records fail + incident when bookError set", async () => {
    const res = await recordPaidBookPath(
      { env: {} },
      {
        pathId: "intro_paid_book",
        source: "ghl-purchase-webhook:intro",
        contact: { id: "c1", firstName: "A", lastName: "B" },
        productName: "Intro",
        orderId: "o1",
        bookError: new Error("slot gone"),
      },
    );
    expect(res.outcome).toBe("fail");
    expect(recordOpsEvent).toHaveBeenCalled();
  });
});

describe("writeOpsLastRun", () => {
  it("writes JSON to PORTAL_KV", async () => {
    const put = vi.fn(async () => {});
    const res = await writeOpsLastRun(
      { PORTAL_KV: { put } },
      OPS_LAST_RUN_KEYS.reminder,
      { status: "ok", due: 2 },
    );
    expect(res.written).toBe(true);
    expect(put).toHaveBeenCalledWith(
      OPS_LAST_RUN_KEYS.reminder,
      expect.stringContaining('"status":"ok"'),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });
});
