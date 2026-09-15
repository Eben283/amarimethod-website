import { describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./quiz-intake-readiness.js";

const OPS_KEY = "ops-key";
const WORKER_KEY = "worker-key";

function request(key = OPS_KEY) {
  return new Request("https://www.amarimethod.com/api/ops/quiz-intake-readiness", {
    headers: key ? { "X-Service-Key": key } : {},
  });
}

function readyPayload(overrides = {}) {
  return {
    success: true,
    worker: "amari-crm-mirror",
    state: "empty",
    nurtureDispatch: {
      configured: true,
      shadowOnly: true,
      deliveryEnabled: false,
    },
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    request: request(),
    env: {
      OPS_READ_KEY: OPS_KEY,
      WORKER_AUTH_SECRET: WORKER_KEY,
      OWNED_QUIZ_BRIDGE_RELEASE: "approved",
      CRM_MIRROR: {
        fetch: vi.fn(async () => Response.json(readyPayload())),
      },
      ...overrides,
    },
  };
}

describe("GET /api/ops/quiz-intake-readiness", () => {
  it("requires the protected ops key", async () => {
    const ctx = context();
    ctx.request = request("");

    const response = await onRequestGet(ctx);

    expect(response.status).toBe(401);
    expect(ctx.env.CRM_MIRROR.fetch).not.toHaveBeenCalled();
  });

  it("fails closed before the binding call when release controls are incomplete", async () => {
    const ctx = context({ OWNED_QUIZ_BRIDGE_RELEASE: undefined });

    const response = await onRequestGet(ctx);

    expect(response.status).toBe(422);
    expect(ctx.env.CRM_MIRROR.fetch).not.toHaveBeenCalled();
  });

  it("proves the native binding and shared Worker authentication without customer writes", async () => {
    const ctx = context();

    const response = await onRequestGet(ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      worker: "amari-crm-mirror",
      intakeState: "empty",
      nurtureShadowOnly: true,
      deliveryEnabled: false,
    });
    expect(ctx.env.CRM_MIRROR.fetch).toHaveBeenCalledTimes(1);
    const [upstreamRequest] = ctx.env.CRM_MIRROR.fetch.mock.calls[0];
    expect(upstreamRequest.method).toBe("GET");
    expect(upstreamRequest.url).toBe("https://amari-crm-mirror.internal/quiz-intake/readiness");
    expect(upstreamRequest.headers.get("Authorization")).toBe(`Bearer ${WORKER_KEY}`);
  });

  it("does not report ready when owned nurture delivery is enabled", async () => {
    const ctx = context({
      CRM_MIRROR: {
        fetch: vi.fn(async () => Response.json(readyPayload({
          nurtureDispatch: { configured: true, shadowOnly: false, deliveryEnabled: true },
        }))),
      },
    });

    const response = await onRequestGet(ctx);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, error: "owned CRM readiness proof failed" });
  });

  it("hides upstream details when the binding or authentication fails", async () => {
    const ctx = context({
      CRM_MIRROR: { fetch: vi.fn(async () => new Response("unauthorized", { status: 401 })) },
    });

    const response = await onRequestGet(ctx);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: false,
      error: "owned CRM readiness proof failed",
    }));
  });
});
