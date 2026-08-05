import { describe, it, expect, vi } from "vitest";
import { requireOpsReadKey, opsReadKeyActive } from "./ops-auth.js";

const KEY = "ops-k3y-abc123";
const req = (headers) =>
  new Request("https://amarimethod.com/api/daily-audit", headers ? { headers } : undefined);

describe("requireOpsReadKey", () => {
  it("500s (fails CLOSED) + logs when no key is configured — deny PII without a Cloudflare-replaced 503", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(requireOpsReadKey(req(), {}).status).toBe(500);
    expect(requireOpsReadKey(req({ "X-Service-Key": "whatever" }), { OPS_READ_KEY: "" }).status).toBe(500);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("preserves caller response headers on every denial", () => {
    const headers = { "Access-Control-Allow-Origin": "https://www.amarimethod.com" };
    const response = requireOpsReadKey(req(), { OPS_READ_KEY: KEY }, headers);
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://www.amarimethod.com");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("ALLOWS a correct key via X-Service-Key or Authorization: Bearer", () => {
    expect(requireOpsReadKey(req({ "X-Service-Key": KEY }), { OPS_READ_KEY: KEY })).toBe(null);
    expect(requireOpsReadKey(req({ Authorization: `Bearer ${KEY}` }), { OPS_READ_KEY: KEY })).toBe(null);
  });

  it("401s when the key is configured but the header is missing or wrong", () => {
    const env = { OPS_READ_KEY: KEY };
    expect(requireOpsReadKey(req(), env).status).toBe(401);
    expect(requireOpsReadKey(req({ "X-Service-Key": "wrong" }), env).status).toBe(401);
    expect(requireOpsReadKey(req({ Authorization: `Bearer ${KEY}x` }), env).status).toBe(401);
  });
});

describe("opsReadKeyActive", () => {
  it("reflects whether the key is configured", () => {
    expect(opsReadKeyActive({})).toBe(false);
    expect(opsReadKeyActive({ OPS_READ_KEY: "" })).toBe(false);
    expect(opsReadKeyActive({ OPS_READ_KEY: KEY })).toBe(true);
  });
});
