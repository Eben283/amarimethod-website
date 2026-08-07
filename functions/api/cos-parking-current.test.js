import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
  verifySessionToken: vi.fn(async () => ({ role: "cos", user: "Eben" })),
}));

import { onRequestGet } from "./cos-parking-current.js";
import { verifySessionToken } from "../lib/auth.js";

afterEach(() => vi.clearAllMocks());

function context(history, rules = null) {
  return {
    request: new Request("https://www.amarimethod.com/api/cos-parking-current", {
      headers: { Authorization: "Bearer test-token", Origin: "https://www.amarimethod.com" },
    }),
    env: {
      JWT_SECRET: "test-secret",
      PORTAL_KV: {
        get: vi.fn(async (key) => {
          if (key === "cos:parking-history:Eben") return JSON.stringify(history);
          if (key === "cos:parking-rules") return rules ? JSON.stringify(rules) : null;
          return null;
        }),
      },
    },
  };
}

describe("GET /api/cos-parking-current", () => {
  it("returns the latest signed-in user's saved parking snapshot without using chat", async () => {
    const response = await onRequestGet(context([
      { location: "5th & Clement", parked_at: "2026-08-05T22:00:00.000Z" },
      {
        location: "763 10th Avenue", side: "west", parked_at: "2026-08-06T01:12:00.000Z",
        rule_type: "street_sweeping", rule_detail: "1st & 3rd Wednesday, 8–10 AM",
        deadline_iso: "2026-08-19T15:45:00.000Z",
      },
    ]));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      parking: {
        location: "763 10th Avenue",
        side: "west",
        deadline_iso: "2026-08-19T15:45:00.000Z",
        rules: [{ type: "street_sweeping", detail: "1st & 3rd Wednesday, 8–10 AM" }],
      },
    });
  });

  it("shows only the saved curb side's block rules", async () => {
    const response = await onRequestGet(context([{
      location: "763 10th Avenue", block_key: "763 10th avenue", side: "west",
      parked_at: "2026-08-06T01:12:00.000Z", rule_type: "unknown",
    }], {
      "763 10th avenue": {
        sides: {
          west: { rules: [{ rule_type: "street_sweeping", rule_detail: "Wed 1st & 3rd, 8–10 AM" }] },
          east: { rules: [{ rule_type: "street_sweeping", rule_detail: "Mon 1st & 3rd, 8–10 AM" }] },
        },
      },
    }));

    expect((await response.json()).parking.rules).toEqual([
      { type: "street_sweeping", detail: "Wed 1st & 3rd, 8–10 AM", side: "west" },
    ]);
  });

  it("derives the next move-by date from a saved Public Works sweep rule", async () => {
    const response = await onRequestGet(context([{
      location: "727 10th Ave, Inner Richmond, SF", side: "east",
      parked_at: "2026-08-06T23:08:00.000Z", rule_type: "street_sweeping",
      rule_detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    }]));

    expect((await response.json()).parking).toMatchObject({
      move_by_label: "Sunday, August 16",
      rules: [{
        type: "street_sweeping",
        detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
      }],
    });
  });

  it("does not repeat a City sweep rule from the older block note", async () => {
    const response = await onRequestGet(context([{
      location: "727 10th Ave, Inner Richmond, SF", block_key: "727 10th avenue inner richmond sf",
      side: "east", parked_at: "2026-08-06T23:08:00.000Z", rule_type: "street_sweeping",
      rule_detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    }], {
      "727 10th avenue inner richmond sf": {
        sides: { east: { rules: [{
          rule_type: "street_sweeping",
          rule_detail: "East side: Mon 1st & 3rd 8am–10am (SF Public Works). West side rules TBD",
        }] } },
      },
    }));

    expect((await response.json()).parking.rules).toHaveLength(1);
  });

  it("does not disclose a parking snapshot to a non-COS session", async () => {
    verifySessionToken.mockResolvedValueOnce({ role: "staff", user: "Eben" });
    const ctx = context([{ location: "763 10th Avenue" }]);

    const response = await onRequestGet(ctx);

    expect(response.status).toBe(401);
    expect(ctx.env.PORTAL_KV.get).not.toHaveBeenCalled();
  });

  it("returns a CORS-bearing storage error instead of treating unavailable storage as no parking", async () => {
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/cos-parking-current", {
        headers: { Authorization: "Bearer test-token", Origin: "https://www.amarimethod.com" },
      }),
      env: { JWT_SECRET: "test-secret" },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://www.amarimethod.com");
    expect(await response.json()).toEqual({ error: "Storage not available" });
  });
});
