import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ghl.js", () => ({
  getGhlToken: vi.fn(async () => "test-ghl-key"),
  ghlHeaders: () => ({ Authorization: "Bearer test-ghl-key" }),
}));

import { normalizeQuizSubmission, onRequestPost } from "./send-to-ghl.js";

function validSubmission(overrides = {}) {
  return {
    firstName: "Ari",
    lastName: "Example",
    email: "ari@example.test",
    phone: "4155551212",
    patternSignature: "Pattern A",
    recoveryPotentialScore: 72,
    primaryPainLocation: "Lower back",
    painSeverity: "moderate",
    painDuration: "3 months",
    treatmentsTried: "",
    painTrigger: "Running",
    additionalPainAreas: "",
    painIntensity: "Moderate",
    painTiming: "Morning",
    painType: "Tightness",
    aggravatingActivities: "Sitting",
    dailyImpact: "Work",
    treatmentResults: "",
    healthConditions: "",
    scores: {
      softTissueTension: 50,
      jointBoneAlignment: 50,
      patternDuration: 50,
      dailyActivitiesImpact: 50,
      bodyAdaptations: 50,
    },
    insights: [{ title: "A useful observation", description: "A short explanation." }],
    ...overrides,
  };
}

function makeKv() {
  const values = new Map();
  return {
    get: vi.fn(async (key) => values.get(key) || null),
    put: vi.fn(async (key, value) => values.set(key, value)),
    delete: vi.fn(async (key) => values.delete(key)),
  };
}

function context(body, headers = {}, env = {}) {
  return {
    request: new Request("https://www.amarimethod.com/api/send-to-ghl", {
      method: "POST",
      headers: {
        Origin: "https://www.amarimethod.com",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    env,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn(async (url) => {
    if (url.includes("siteverify")) return Response.json({ success: true });
    if (url.includes("/contacts/upsert")) return Response.json({ contact: { id: "contact-1" } });
    return Response.json({});
  });
});

describe("quiz submission boundary", () => {
  it("normalizes the valid browser payload without changing its lifecycle fields", () => {
    expect(normalizeQuizSubmission(validSubmission({
      email: " Ari@Example.TEST ",
      referralSource: "garrettmtb",
    }))).toMatchObject({
      firstName: "Ari",
      email: "ari@example.test",
      referralSource: "garrettmtb",
      recoveryPotentialScore: 72,
    });
  });

  it("rejects malformed tags, non-text health fields, and out-of-range scores", () => {
    expect(normalizeQuizSubmission(validSubmission({ referralSource: "forged tag!" }))).toBeNull();
    expect(normalizeQuizSubmission(validSubmission({ healthConditions: { injected: true } }))).toBeNull();
    expect(normalizeQuizSubmission(validSubmission({ recoveryPotentialScore: 101 }))).toBeNull();
  });

  it("rejects a cross-origin post before it can request a GHL credential", async () => {
    const response = await onRequestPost(context(validSubmission(), {
      Origin: "https://attacker.example",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Submission must come from the Amari quiz." });
  });

  it("requires JSON rather than accepting a browser-simple cross-site post", async () => {
    const response = await onRequestPost(context(validSubmission(), {
      "Content-Type": "text/plain",
    }));

    expect(response.status).toBe(415);
  });

  it("rejects a failed bot proof before requesting a GHL credential or writing", async () => {
    global.fetch = vi.fn(async () => Response.json({ success: false }));
    const response = await onRequestPost(
      context({ ...validSubmission(), turnstileToken: "bot-token" }, {}, {
        TURNSTILE_SECRET_KEY: "turnstile-secret",
        PORTAL_KV: makeKv(),
      }),
    );

    expect(response.status).toBe(403);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain("siteverify");
  });

  it("fails closed when the rate-limit KV is unavailable", async () => {
    const response = await onRequestPost(
      context({ ...validSubmission(), turnstileToken: "human-token" }, {}, {
        TURNSTILE_SECRET_KEY: "turnstile-secret",
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Submission protection unavailable." });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not write to GHL when KV fails during protection", async () => {
    const kv = makeKv();
    kv.get.mockRejectedValueOnce(new Error("KV down"));
    const response = await onRequestPost(
      context({ ...validSubmission(), turnstileToken: "human-token" }, {}, {
        TURNSTILE_SECRET_KEY: "turnstile-secret",
        PORTAL_KV: kv,
      }),
    );

    expect(response.status).toBe(422);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("treats an identical second submission as a duplicate", async () => {
    const kv = makeKv();
    const body = { ...validSubmission(), turnstileToken: "human-token" };
    const env = { TURNSTILE_SECRET_KEY: "turnstile-secret", PORTAL_KV: kv };

    const first = await onRequestPost(context(body, {}, env));
    const second = await onRequestPost(context(body, {}, env));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ success: true, duplicate: true });
    expect(global.fetch.mock.calls.filter(([url]) => url.includes("/contacts/upsert"))).toHaveLength(1);
  });
});
