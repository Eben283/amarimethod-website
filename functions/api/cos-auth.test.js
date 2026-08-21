import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/rate-limit.js", () => ({
  pinRateLimitKv: vi.fn((env) => env.PORTAL_KV || env.STAFF_AUTH_RATE_LIMIT_KV || null),
  checkPinAttempts: vi.fn(async () => ({ ok: true, count: 0 })),
  recordFailedPinAttempt: vi.fn(),
  clearPinAttempts: vi.fn(),
}));
vi.mock("../lib/ops-last-run.js", () => ({
  OPS_LAST_RUN_KEYS: { cosAuth: "ops:cos-auth:lastRun" },
  writeOpsLastRun: vi.fn(),
}));

import { onRequestPost } from "./cos-auth.js";

afterEach(() => vi.clearAllMocks());

describe("POST /api/cos-auth", () => {
  it("accepts Eben's Staff PIN, not a separate COS-only PIN", async () => {
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/cos-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://www.amarimethod.com" },
        body: JSON.stringify({ pin: "2468" }),
      }),
      env: {
        JWT_SECRET: "test-secret",
        STAFF_PIN_EBEN: "2468",
        STAFF_PIN_GARRETT: "1357",
        COS_PIN_EBEN: "9999",
        PORTAL_KV: { put: vi.fn() },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: expect.any(String) });
  });
});
