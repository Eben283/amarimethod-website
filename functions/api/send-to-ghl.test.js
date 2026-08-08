import { describe, expect, it } from "vitest";
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

function context(body, headers = {}) {
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
    env: {},
  };
}

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
});
