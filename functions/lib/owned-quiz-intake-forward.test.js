import { describe, expect, it, vi } from "vitest";
import {
  forwardOwnedQuizIntake,
  OWNED_QUIZ_BRIDGE_SOURCE_MODE,
  ownedQuizIntakePayload,
} from "./owned-quiz-intake-forward.js";
import { normalizeOwnedQuizIntake } from "../../crm-mirror-worker/src/owned-quiz-intake.js";

const submission = {
  firstName: "Ari",
  lastName: "Example",
  email: "ari@example.test",
  phone: "+14155551212",
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
  insights: [{ title: "Observation", description: "Explanation" }],
  referralSource: "garrettmtb",
};

function payload() {
  return ownedQuizIntakePayload(submission, {
    idempotencyKey: "a".repeat(64),
    audience: "bay-area",
    resultsSummary: "Exact normalized summary",
  });
}

describe("owned public quiz intake bridge", () => {
  it("produces the exact strict contract accepted by the owned CRM", () => {
    expect(normalizeOwnedQuizIntake(payload())).toEqual(expect.objectContaining({
      idempotencyKey: "a".repeat(64),
      email: "ari@example.test",
      audience: "bay-area",
      resultsSummary: "Exact normalized summary",
    }));
  });

  it("is source-level active but still cannot run without the independent release flag", async () => {
    expect(OWNED_QUIZ_BRIDGE_SOURCE_MODE).toBe("active");
    const fetch = vi.fn();
    await expect(forwardOwnedQuizIntake({
      WORKER_AUTH_SECRET: "secret",
      CRM_MIRROR: { fetch },
    }, payload())).resolves.toEqual({ ok: false, error: "release_not_approved" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the independent release flag, private binding, and Worker auth", async () => {
    await expect(forwardOwnedQuizIntake({}, payload()))
      .resolves.toEqual({ ok: false, error: "release_not_approved" });
    await expect(forwardOwnedQuizIntake({ OWNED_QUIZ_BRIDGE_RELEASE: "approved" }, payload()))
      .resolves.toEqual({ ok: false, error: "owned_intake_unconfigured" });
  });

  it("sends exactly the normalized payload through the authenticated service binding", async () => {
    const fetch = vi.fn(async (request) => {
      expect(request.url).toBe("https://crm-mirror.internal/contacts/quiz-intake");
      expect(request.headers.get("Authorization")).toBe("Bearer private-secret");
      expect(await request.json()).toEqual(payload());
      return Response.json({
        success: true,
        contactId: "contact_email_1234",
        payloadSha256: "b".repeat(64),
        deduped: false,
      }, { status: 201 });
    });
    await expect(forwardOwnedQuizIntake({
      OWNED_QUIZ_BRIDGE_RELEASE: "approved",
      WORKER_AUTH_SECRET: "private-secret",
      CRM_MIRROR: { fetch },
    }, payload())).resolves.toEqual({ ok: true, deduped: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed on transport, rejection, or an untrusted acknowledgement", async () => {
    const env = (fetch) => ({
      OWNED_QUIZ_BRIDGE_RELEASE: "approved",
      WORKER_AUTH_SECRET: "secret",
      CRM_MIRROR: { fetch },
    });
    await expect(forwardOwnedQuizIntake(env(async () => { throw new Error("offline"); }), payload()))
      .resolves.toEqual({ ok: false, error: "owned_intake_unavailable" });
    await expect(forwardOwnedQuizIntake(env(async () => new Response("no", { status: 409 })), payload()))
      .resolves.toEqual({ ok: false, error: "owned_intake_rejected", status: 409 });
    await expect(forwardOwnedQuizIntake(env(async () => Response.json({ success: true })), payload()))
      .resolves.toEqual({ ok: false, error: "owned_intake_invalid_acknowledgement" });
  });
});
