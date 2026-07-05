import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requireWorkerAuth, workerAuthActive } from "./worker-auth.js";

const SECRET = "s3cr3t-abc123";
const req = (auth) =>
  new Request("https://w.workers.dev/run", auth ? { headers: { Authorization: auth } } : undefined);

describe("requireWorkerAuth", () => {
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("503s (fails CLOSED) + logs when no secret is configured — deny, don't expose", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(requireWorkerAuth(req(), {}).status).toBe(503);
    expect(requireWorkerAuth(req(`Bearer whatever`), { WORKER_AUTH_SECRET: "" }).status).toBe(503);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("ALLOWS a correct Bearer token when the secret is configured", () => {
    expect(requireWorkerAuth(req(`Bearer ${SECRET}`), { WORKER_AUTH_SECRET: SECRET })).toBe(null);
  });

  it("401s when the secret is configured but the header is missing", () => {
    const denied = requireWorkerAuth(req(), { WORKER_AUTH_SECRET: SECRET });
    expect(denied).not.toBe(null);
    expect(denied.status).toBe(401);
  });

  it("401s on a wrong token, a wrong scheme, or a bare secret without Bearer", () => {
    const env = { WORKER_AUTH_SECRET: SECRET };
    expect(requireWorkerAuth(req("Bearer wrong"), env).status).toBe(401);
    expect(requireWorkerAuth(req(`Basic ${SECRET}`), env).status).toBe(401);
    expect(requireWorkerAuth(req(SECRET), env).status).toBe(401);
  });

  it("does not authorize a token that is a prefix/suffix of the secret (length-checked)", () => {
    const env = { WORKER_AUTH_SECRET: SECRET };
    expect(requireWorkerAuth(req(`Bearer ${SECRET}x`), env).status).toBe(401);
    expect(requireWorkerAuth(req(`Bearer ${SECRET.slice(0, -1)}`), env).status).toBe(401);
  });
});

describe("workerAuthActive", () => {
  it("reflects whether the secret is configured", () => {
    expect(workerAuthActive({})).toBe(false);
    expect(workerAuthActive({ WORKER_AUTH_SECRET: "" })).toBe(false);
    expect(workerAuthActive({ WORKER_AUTH_SECRET: SECRET })).toBe(true);
  });
});
