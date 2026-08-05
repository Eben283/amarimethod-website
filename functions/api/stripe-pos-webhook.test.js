import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/stripe-api.js", () => ({
  verifyStripeWebhookSignature: vi.fn(async () => true),
}));
vi.mock("../lib/processed-events.js", () => ({
  claimProcessedEvent: vi.fn(),
  releaseProcessedEvent: vi.fn(),
}));
vi.mock("../lib/ops-last-run.js", () => ({
  OPS_LAST_RUN_KEYS: { stripeWebhook: "stripe-webhook" },
  writeOpsLastRun: vi.fn(async () => {}),
}));

import { onRequestPost } from "./stripe-pos-webhook.js";
import { claimProcessedEvent, releaseProcessedEvent } from "../lib/processed-events.js";

describe("Stripe POS webhook claim lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimProcessedEvent.mockResolvedValue({ ok: true });
    releaseProcessedEvent.mockResolvedValue({ ok: true });
  });

  it("releases the Stripe event claim when settlement fails", async () => {
    const db = {};
    const context = {
      env: {
        STRIPE_POS_WEBHOOK_SECRET: "whsec_test",
        ATTEND_DB: db,
        PORTAL_KV: {
          get: vi.fn(async () => { throw new Error("POS storage unavailable"); }),
        },
      },
      request: new Request("https://www.amarimethod.com/api/stripe-pos-webhook", {
        method: "POST",
        headers: { "Stripe-Signature": "test" },
        body: JSON.stringify({
          id: "evt_retryable",
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_retryable",
              payment_status: "paid",
              metadata: { sale_id: "pos_retryable", payment_leg_id: "leg-1" },
            },
          },
        }),
      }),
    };

    const response = await onRequestPost(context);

    expect(response.status).toBe(500);
    expect(releaseProcessedEvent).toHaveBeenCalledWith(db, "stripe:evt_retryable");
  });
});
