// Resolve the public study-booking runtime without letting a Pages preview
// inherit production D1, KV, OAuth, rate-limit, or evidence state.

const PRODUCTION_ORIGINS = new Set([
  "https://www.amarimethod.com",
  "https://amarimethod.com",
]);
const PREVIEW_HOST_SUFFIX = ".amarimethod-website.pages.dev";

export class StudyBookingRuntimeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "StudyBookingRuntimeError";
    this.status = status;
  }
}

export function configuredStudyBookingPreviewOrigin(env = {}) {
  const raw = String(env.STUDY_BOOKING_PREVIEW_ORIGIN || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const validHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.amarimethod-website\.pages\.dev$/i
      .test(url.hostname);
    if (url.origin !== raw || url.protocol !== "https:" || !validHost ||
        !url.hostname.endsWith(PREVIEW_HOST_SUFFIX)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function routeFor(request, env) {
  const urlOrigin = new URL(request.url).origin;
  if (PRODUCTION_ORIGINS.has(urlOrigin)) {
    return { mode: "production", urlOrigin, previewOrigin: null };
  }
  const previewOrigin = configuredStudyBookingPreviewOrigin(env);
  if (previewOrigin && urlOrigin === previewOrigin) {
    return { mode: "preview", urlOrigin, previewOrigin };
  }
  return { mode: "invalid", urlOrigin, previewOrigin };
}

export function studyBookingCorsOrigin(request, env = {}) {
  const requestOrigin = request.headers.get("Origin") || "";
  const route = routeFor(request, env);
  if (route.mode === "production" && PRODUCTION_ORIGINS.has(requestOrigin)) {
    return requestOrigin;
  }
  if (route.mode === "preview" && requestOrigin === route.previewOrigin) {
    return requestOrigin;
  }
  return "https://www.amarimethod.com";
}

function requirePreviewBinding(env, name) {
  if (!env[name]) {
    throw new StudyBookingRuntimeError(
      "The isolated study proof environment is not fully provisioned.",
      500,
    );
  }
  return env[name];
}

export function resolveStudyBookingRuntime(context, options = {}) {
  const route = routeFor(context.request, context.env || {});
  const requestOrigin = context.request.headers.get("Origin") || "";

  if (route.mode === "invalid") {
    throw new StudyBookingRuntimeError("Origin is not allowed.", 403);
  }
  if (options.mutation) {
    const exactOrigin = route.mode === "production"
      ? PRODUCTION_ORIGINS.has(requestOrigin)
      : requestOrigin === route.previewOrigin;
    if (!exactOrigin) {
      throw new StudyBookingRuntimeError("Origin is not allowed.", 403);
    }
  }

  if (route.mode === "production") {
    if (options.mutation && !context.env.ATTEND_DB) {
      throw new StudyBookingRuntimeError(
        "Booking state is temporarily unavailable. Please try again.",
        500,
      );
    }
    return {
      mode: "production",
      providerContext: context,
      db: context.env.ATTEND_DB || null,
      rateLimitKv: context.env.PORTAL_KV || null,
      evidenceEnv: context.env,
      fixtureContactId: null,
    };
  }

  const db = requirePreviewBinding(context.env, "STUDY_PREVIEW_ATTEND_DB");
  const rateLimitKv = requirePreviewBinding(context.env, "STUDY_PREVIEW_RATE_LIMIT_KV");
  const evidenceKv = requirePreviewBinding(context.env, "STUDY_PREVIEW_EVIDENCE_KV");
  const apiKey = requirePreviewBinding(context.env, "GHL_API_KEY");
  const fixtureContactId = String(
    requirePreviewBinding(context.env, "STUDY_PREVIEW_FIXTURE_CONTACT_ID"),
  ).trim();
  if (!fixtureContactId) {
    throw new StudyBookingRuntimeError(
      "The isolated study proof environment is not fully provisioned.",
      500,
    );
  }

  // Deliberately omit PORTAL_KV and OAuth client credentials. ghlFetch can use
  // only the existing Preview API key, without OAuth state, and therefore cannot read,
  // refresh, or replace production OAuth state.
  const providerContext = {
    ...context,
    env: Object.freeze({ GHL_API_KEY: apiKey }),
  };

  return {
    mode: "preview",
    providerContext,
    db,
    rateLimitKv,
    evidenceEnv: Object.freeze({ PORTAL_KV: evidenceKv }),
    fixtureContactId,
  };
}
