import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./delivery-receipts.js", () => ({
  reconcileDeliveryReceipts: vi.fn(),
}));

import worker from "./index.js";
import { reconcileDeliveryReceipts } from "./delivery-receipts.js";

describe("POST /receipts/run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs receipt reconciliation only and cannot invoke the send cycle", async () => {
    reconcileDeliveryReceipts.mockResolvedValue({ checked: 2, recorded: 2, pending: 0, errors: 0 });
    const response = await worker.fetch(new Request("https://reminder.test/receipts/run", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    }), { WORKER_AUTH_SECRET: "test-secret" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      receipts: { checked: 2, recorded: 2, pending: 0, errors: 0 },
    });
    expect(reconcileDeliveryReceipts).toHaveBeenCalledOnce();
  });
});
