import { afterEach, describe, expect, it, vi } from "vitest";
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

function protectionKV(overrides = {}) {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

function turnstileSuccess() {
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

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

  it("rejects missing or invalid bot proof before making a GHL request", async () => {
    const kv = protectionKV();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const missing = await onRequestPost(context(validSubmission(), {}, {
      TURNSTILE_SECRET_KEY: "test-secret",
      PORTAL_KV: kv,
    }));
    const invalid = await onRequestPost(context(validSubmission({ turnstileToken: "invalid" }), {}, {
      TURNSTILE_SECRET_KEY: "test-secret",
      PORTAL_KV: kv,
    }));

    expect(missing.status).toBe(403);
    expect(invalid.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("services.leadconnectorhq.com"))).toBe(false);
  });

  it("fails closed when the KV protection capability is absent or errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => turnstileSuccess()));
    const body = validSubmission({ turnstileToken: "valid" });

    const missing = await onRequestPost(context(body, {}, { TURNSTILE_SECRET_KEY: "test-secret" }));
    const broken = await onRequestPost(context(body, {}, {
      TURNSTILE_SECRET_KEY: "test-secret",
      PORTAL_KV: protectionKV({ get: vi.fn(async () => { throw new Error("KV unavailable"); }) }),
    }));

    expect(missing.status).toBe(422);
    expect(broken.status).toBe(422);
    expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes("services.leadconnectorhq.com"))).toBe(false);
  });

  it("treats a duplicate submission as idempotent before any GHL write", async () => {
    const kv = protectionKV({
      get: vi.fn(async (key) => key.startsWith("quiz_submission:") ? "processing" : null),
    });
    const fetchSpy = vi.fn(async () => turnstileSuccess());
    vi.stubGlobal("fetch", fetchSpy);

    const response = await onRequestPost(context(validSubmission({ turnstileToken: "valid" }), {}, {
      TURNSTILE_SECRET_KEY: "test-secret",
      PORTAL_KV: kv,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, duplicate: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("services.leadconnectorhq.com"))).toBe(false);
  });

  it("accepts one valid preview proof without exposing GHL to the test", async () => {
    const values = new Map();
    const kv = protectionKV({
      get: vi.fn(async (key) => values.get(key) || null),
      put: vi.fn(async (key, value) => { values.set(key, value); }),
    });
    const fetchSpy = vi.fn(async () => turnstileSuccess());
    vi.stubGlobal("fetch", fetchSpy);
    const env = {
      TURNSTILE_SECRET_KEY: "test-secret",
      PORTAL_KV: kv,
      QUIZ_SUBMISSION_MODE: "verify_only",
    };

    const first = await onRequestPost(context(validSubmission({ turnstileToken: "valid" }), {}, env));
    const duplicate = await onRequestPost(context(validSubmission({ turnstileToken: "valid" }), {}, env));

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, verificationOnly: true });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ success: true, duplicate: true });
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("services.leadconnectorhq.com"))).toBe(false);
  });
});
