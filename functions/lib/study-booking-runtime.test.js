import { describe, expect, it } from "vitest";

import {
  StudyBookingRuntimeError,
  configuredStudyBookingPreviewOrigin,
  resolveStudyBookingRuntime,
  studyBookingCorsOrigin,
} from "./study-booking-runtime.js";

const PREVIEW = "https://codex-study-single-entry-boo.amarimethod-website.pages.dev";

function request(url, origin) {
  return new Request(url, {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });
}

function previewEnv(overrides = {}) {
  return {
    STUDY_BOOKING_PREVIEW_ORIGIN: PREVIEW,
    STUDY_PREVIEW_ATTEND_DB: { name: "proof-db" },
    STUDY_PREVIEW_RATE_LIMIT_KV: { name: "proof-rate" },
    STUDY_PREVIEW_EVIDENCE_KV: { name: "proof-evidence" },
    GHL_API_KEY: "proof-only-key",
    STUDY_PREVIEW_FIXTURE_CONTACT_ID: "fixture-contact",
    ATTEND_DB: { name: "production-db" },
    PORTAL_KV: { name: "production-oauth" },
    GHL_CLIENT_ID: "production-client",
    GHL_CLIENT_SECRET: "production-secret",
    ...overrides,
  };
}

describe("study booking runtime isolation", () => {
  it("keeps the production runtime and bindings unchanged", () => {
    const env = {
      ATTEND_DB: { name: "production-db" },
      PORTAL_KV: { name: "production-kv" },
    };
    const context = {
      request: request("https://www.amarimethod.com/api/study-book-v2", "https://www.amarimethod.com"),
      env,
    };
    const runtime = resolveStudyBookingRuntime(context, { mutation: true });

    expect(runtime.mode).toBe("production");
    expect(runtime.providerContext).toBe(context);
    expect(runtime.db).toBe(env.ATTEND_DB);
    expect(runtime.rateLimitKv).toBe(env.PORTAL_KV);
    expect(runtime.evidenceEnv).toBe(env);
    expect(runtime.fixtureContactId).toBeNull();
  });

  it("selects only the exact configured preview host and isolated resources", () => {
    const env = previewEnv();
    const context = {
      request: request(PREVIEW + "/api/study-book-v2", PREVIEW),
      env,
    };
    const runtime = resolveStudyBookingRuntime(context, { mutation: true });

    expect(runtime.mode).toBe("preview");
    expect(runtime.db).toBe(env.STUDY_PREVIEW_ATTEND_DB);
    expect(runtime.rateLimitKv).toBe(env.STUDY_PREVIEW_RATE_LIMIT_KV);
    expect(runtime.evidenceEnv).toEqual({ PORTAL_KV: env.STUDY_PREVIEW_EVIDENCE_KV });
    expect(runtime.fixtureContactId).toBe("fixture-contact");
    expect(runtime.providerContext.env).toEqual({ GHL_API_KEY: "proof-only-key" });
    expect(runtime.providerContext.env).not.toHaveProperty("PORTAL_KV");
    expect(runtime.providerContext.env).not.toHaveProperty("GHL_CLIENT_ID");
    expect(runtime.providerContext.env).not.toHaveProperty("GHL_CLIENT_SECRET");
    expect(runtime.providerContext.env).not.toHaveProperty("ATTEND_DB");
  });

  it("rejects arbitrary Pages previews and a production Origin aimed at preview", () => {
    const arbitrary = {
      request: request(
        "https://01234567.amarimethod-website.pages.dev/api/study-book-v2",
        "https://01234567.amarimethod-website.pages.dev",
      ),
      env: previewEnv(),
    };
    expect(() => resolveStudyBookingRuntime(arbitrary, { mutation: true }))
      .toThrow(StudyBookingRuntimeError);

    const crossTarget = {
      request: request(PREVIEW + "/api/study-book-v2", "https://www.amarimethod.com"),
      env: previewEnv(),
    };
    expect(() => resolveStudyBookingRuntime(crossTarget, { mutation: true }))
      .toThrow("Origin is not allowed.");
    expect(studyBookingCorsOrigin(crossTarget.request, crossTarget.env))
      .toBe("https://www.amarimethod.com");
  });

  it("fails closed when any isolated preview binding is missing", () => {
    const env = previewEnv({ STUDY_PREVIEW_EVIDENCE_KV: null });
    const context = {
      request: request(PREVIEW + "/api/study-book-v2", PREVIEW),
      env,
    };
    expect(() => resolveStudyBookingRuntime(context, { mutation: true }))
      .toThrow("isolated study proof environment is not fully provisioned");
  });

  it("accepts only a literal configured HTTPS Pages origin", () => {
    expect(configuredStudyBookingPreviewOrigin({
      STUDY_BOOKING_PREVIEW_ORIGIN: PREVIEW,
    })).toBe(PREVIEW);
    expect(configuredStudyBookingPreviewOrigin({
      STUDY_BOOKING_PREVIEW_ORIGIN: "https://*.amarimethod-website.pages.dev",
    })).toBeNull();
    expect(configuredStudyBookingPreviewOrigin({
      STUDY_BOOKING_PREVIEW_ORIGIN: PREVIEW + "/path",
    })).toBeNull();
  });
});
