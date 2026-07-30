import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth.js", () => ({
  verifySessionToken: vi.fn(),
}));

import { requireEbenStaffAuth } from "./endpoint-guards.js";
import { verifySessionToken } from "./auth.js";

beforeEach(() => vi.clearAllMocks());

function ctx(user) {
  verifySessionToken.mockResolvedValue({ role: "staff", user });
  return {
    env: { JWT_SECRET: "s" },
    request: { headers: { get: (h) => (h === "Authorization" ? "Bearer tok" : null) } },
  };
}

describe("requireEbenStaffAuth", () => {
  it("allows Eben", async () => {
    const res = await requireEbenStaffAuth(ctx("Eben"), {});
    expect(res.error).toBeUndefined();
    expect(res.payload.user).toBe("Eben");
  });

  it("403s Garrett", async () => {
    const res = await requireEbenStaffAuth(ctx("Garrett"), { "Content-Type": "application/json" });
    expect(res.error.status).toBe(403);
    expect(await res.error.json()).toEqual({ error: "Amari Ops is Eben-only" });
  });
});
