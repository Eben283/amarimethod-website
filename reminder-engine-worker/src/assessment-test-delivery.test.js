import { describe, expect, it } from "vitest";
import { assessmentCutoverEligibility, assessmentTestEligibility } from "./assessment-test-delivery.js";

const FLOW = { flowKey: "initial-in-person" };
const STEP = { type: "email", template: "confirmation" };
const ENROLLMENT = { calendarId: "EM6vB2mq7EAdGCbUb3j1", contactId: "test-contact" };
const ENV = { ASSESSMENT_TEST_DELIVERY: "enabled", ASSESSMENT_TEST_CONTACT_ID: "test-contact", ASSESSMENT_TEST_RECIPIENT: "eben@amarimethod.com" };

describe("assessmentTestEligibility", () => {
  it("requires every explicit test-only gate before allowing delivery", () => {
    expect(assessmentTestEligibility(ENV, FLOW, STEP, ENROLLMENT)).toEqual({ eligible: true, recipient: "eben@amarimethod.com" });
    expect(assessmentTestEligibility({}, FLOW, STEP, ENROLLMENT).reason).toBe("test-delivery-disabled");
    expect(assessmentTestEligibility({ ...ENV, ASSESSMENT_TEST_CONTACT_ID: "another-contact" }, FLOW, STEP, ENROLLMENT).reason).toBe("contact-not-allowlisted");
    expect(assessmentTestEligibility({ ...ENV, ASSESSMENT_TEST_RECIPIENT: "not-an-email" }, FLOW, STEP, ENROLLMENT).reason).toBe("test-recipient-not-configured");
  });

  it("cannot turn another flow, calendar, or message step into a test send", () => {
    expect(assessmentTestEligibility(ENV, { flowKey: "initial-virtual" }, STEP, ENROLLMENT).eligible).toBe(false);
    expect(assessmentTestEligibility(ENV, FLOW, { type: "sms", template: "confirmation" }, ENROLLMENT).eligible).toBe(false);
    expect(assessmentTestEligibility(ENV, FLOW, STEP, { ...ENROLLMENT, calendarId: "other-calendar" }).eligible).toBe(false);
  });
});

describe("assessmentCutoverEligibility", () => {
  it("is inert until the separate production flag is explicitly enabled", () => {
    expect(assessmentCutoverEligibility({}, FLOW, STEP, ENROLLMENT).reason).toBe("cutover-disabled");
    expect(assessmentCutoverEligibility({ ASSESSMENT_CONFIRMATION_CUTOVER: "enabled" }, FLOW, STEP, ENROLLMENT)).toEqual({ eligible: true });
  });

  it("cannot make another calendar, flow, or step live", () => {
    const env = { ASSESSMENT_CONFIRMATION_CUTOVER: "enabled" };
    expect(assessmentCutoverEligibility(env, { flowKey: "initial-virtual" }, STEP, ENROLLMENT).eligible).toBe(false);
    expect(assessmentCutoverEligibility(env, FLOW, { type: "sms", template: "confirmation" }, ENROLLMENT).eligible).toBe(false);
    expect(assessmentCutoverEligibility(env, FLOW, STEP, { ...ENROLLMENT, calendarId: "other-calendar" }).eligible).toBe(false);
  });
});
