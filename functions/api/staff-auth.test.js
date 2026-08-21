import { afterEach, describe, expect, it, vi } from "vitest";

const rateLimitMocks = vi.hoisted(() => ({
  checkPinAttempts: vi.fn(async () => ({ ok: true, count: 0 })),
  recordFailedPinAttempt: vi.fn(),
  clearPinAttempts: vi.fn(),
}));

vi.mock("../lib/rate-limit.js", () => ({
  pinRateLimitKv: (env) => env.PORTAL_KV || env.STAFF_AUTH_RATE_LIMIT_KV || null,
  ...rateLimitMocks,
}));
vi.mock("../lib/ops-last-run.js", () => ({
  OPS_LAST_RUN_KEYS: { staffAuth: "ops:staff-auth:lastRun" },
  writeOpsLastRun: vi.fn(),
}));

import { onRequestPost } from "./staff-auth.js";

afterEach(() => vi.clearAllMocks());

function loginContext(env) {
  return {
    request: new Request("https://preview.example/api/staff-auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.5",
      },
      body: JSON.stringify({ pin: "2468" }),
    }),
    env: {
      JWT_SECRET: "test-secret",
      STAFF_PIN_EBEN: "2468",
      STAFF_PIN_GARRETT: "1357",
      ...env,
    },
  };
}

describe("POST /api/staff-auth", () => {
  it("uses the isolated Staff auth namespace when a preview has no production PORTAL_KV", async () => {
    const previewKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const response = await onRequestPost(loginContext({ STAFF_AUTH_RATE_LIMIT_KV: previewKv }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("staff_session=");
    expect(rateLimitMocks.checkPinAttempts).toHaveBeenCalledWith(
      previewKv,
      { ip: "203.0.113.5", scope: "staff" },
    );
    expect(rateLimitMocks.clearPinAttempts).toHaveBeenCalledWith(
      previewKv,
      { ip: "203.0.113.5", scope: "staff" },
    );
  });

  it("still prefers production PORTAL_KV when both bindings exist", async () => {
    const productionKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const previewKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const response = await onRequestPost(loginContext({
      PORTAL_KV: productionKv,
      STAFF_AUTH_RATE_LIMIT_KV: previewKv,
    }));

    expect(response.status).toBe(200);
    expect(rateLimitMocks.checkPinAttempts).toHaveBeenCalledWith(
      productionKv,
      { ip: "203.0.113.5", scope: "staff" },
    );
  });
});
