import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(), corsHeaders: () => ({}), parseJsonBody: vi.fn(async request => ({ body: await request.json() })),
}));

import { requireStaffAuth } from "../lib/endpoint-guards.js";
import { onRequestPost } from "./staff-partner-rewards.js";

function db({ qualified = false, paid = false, blocked = null } = {}) {
  const run = vi.fn(async () => ({}));
  const batch = vi.fn(async () => []);
  return {
    batch,
    prepare: vi.fn((sql) => ({
      bind: vi.fn(() => ({
        run,
        first: vi.fn(async () => {
          if (sql.startsWith("SELECT detail") && sql.includes("type='attributed'")) return { detail: JSON.stringify({ referralAt: "2026-08-01T00:00:00Z" }) };
          if (sql.startsWith("SELECT detail") && sql.includes("type='chargeback_hold'")) return { detail: JSON.stringify({ holdUntil: "2026-01-01T00:00:00Z" }) };
          if (sql.includes("type='qualifying_purchase'")) return qualified ? { id: "qualified" } : null;
          if (sql.includes("type='paid'")) return paid ? { id: "paid" } : null;
          if (sql.includes("type IN ('expired'")) return blocked ? { type: blocked } : null;
          return null;
        }),
      })),
    })),
  };
}

function ctx(body, d = db()) {
  return {
    env: { AUTOMATION_DB: d },
    request: new Request("https://www.amarimethod.com/api/staff-partner-rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}

beforeEach(() => { vi.clearAllMocks(); requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } }); });

describe("staff partner rewards", () => {
  it("records a qualifying 12-session purchase as a $250 plus one Amari session chargeback hold", async () => {
    const d = db();
    const response = await onRequestPost(ctx({ action: "qualify", rewardId: "reward_1", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 12 }, d));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ state: "chargeback_hold", amountCents: 25000, sessionEntitlement: "one Amari session" });
    expect(d.batch).toHaveBeenCalledOnce();
  });

  it("rejects a standalone-session purchase and a duplicate qualification", async () => {
    const standalone = await onRequestPost(ctx({ action: "qualify", rewardId: "reward_1", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 1 }));
    expect(standalone.status).toBe(422);
    const duplicate = await onRequestPost(ctx({ action: "qualify", rewardId: "reward_1", purchasedAt: "2026-08-30T00:00:00Z", sessionCount: 12 }, db({ qualified: true })));
    expect(duplicate.status).toBe(409);
  });

  it("records an append-only exception and refuses payout after a dispute", async () => {
    const correction = await onRequestPost(ctx({ action: "correct", rewardId: "reward_1", correctionType: "disputed", reason: "Stripe dispute opened" }));
    expect(correction.status).toBe(201);
    const pay = await onRequestPost(ctx({ action: "pay", rewardId: "reward_1", payoutReference: "bank-123" }, db({ blocked: "disputed" })));
    expect(pay.status).toBe(422);
  });
});
