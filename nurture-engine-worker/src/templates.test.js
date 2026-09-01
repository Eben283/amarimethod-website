import { describe, expect, it } from "vitest";
import {
  FLOW_1_QUIZ_TEMPLATES,
  FLOW_2_POST_DISCOVERY_TEMPLATES,
  FLOW_3_POST_INITIAL_TEMPLATES,
  NURTURE_TEMPLATES,
  flow3MessagePreview,
  getNurtureTemplate,
  renderNurtureTemplate,
} from "./templates.js";
import { SEQUENCES } from "./config.js";

const fields = {
  "contact.first_name": "Ada",
  "contact.primary_pain_location": "Hips",
  "contact.pain_pattern_signature": "Soft Tissue Tension",
  "contact.pain_duration": "6-12 months",
};

const referencedTemplates = () => SEQUENCES.flatMap((sequence) => sequence.steps.flatMap((step) => {
  if (step.template) return [step.template];
  if (step.kind === "branch") return [step.yes, step.no];
  if (step.kind === "branch_map") return [...Object.values(step.map), step.default];
  return [];
}));

describe("owned nurture template catalog", () => {
  it("admits exactly the two current Flow 3 emails and no deleted Day-10 pitch", () => {
    expect(Object.keys(FLOW_3_POST_INITIAL_TEMPLATES)).toEqual([
      "f3-email-1-protocols-portal",
      "f3-email-2-practice-going",
    ]);
    expect(getNurtureTemplate("f3-email-3-series-pitch")).toBeNull();
    expect(Object.isFrozen(FLOW_3_POST_INITIAL_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(FLOW_3_POST_INITIAL_TEMPLATES["f3-email-1-protocols-portal"].from)).toBe(true);
  });

  it("owns every configured Flow 1-3 template with no orphaned catalog entries", () => {
    const referenced = [...new Set(referencedTemplates())].sort();
    expect(Object.keys(NURTURE_TEMPLATES).sort()).toEqual(referenced);
    expect(Object.keys(FLOW_1_QUIZ_TEMPLATES)).toHaveLength(13);
    expect(Object.keys(FLOW_2_POST_DISCOVERY_TEMPLATES)).toHaveLength(3);
    for (const templateId of referenced) {
      const rendered = renderNurtureTemplate(templateId, fields);
      expect(rendered.templateId).toBe(templateId);
      expect(rendered.subject).not.toContain("{{");
      expect(rendered.preheader).not.toContain("{{");
      expect(rendered.body).not.toContain("{{");
    }
  });

  it("pins the reviewed Flow 1 subjects, fallbacks, and distinctive bodies", () => {
    const expectations = {
      "f1-email-1-quiz-results": ["Ada, your Soft Tissue Tension pattern explained", "Your body already knows how to heal."],
      "f1-email-2": ["Why your Hips pain keeps coming back", "After 6-12 months of dealing with Hips pain"],
      "f1-email-2-chronic": ["Why your chronic pain keeps coming back", "After years of persistent pain"],
      "f1-email-3-real-reason": ["The real reason behind your Soft Tissue Tension pattern", "teach your body to hold its own balance"],
      "f1-email-4a-spinal-wave": ["A free exercise for your Hips, Ada", "slowly roll your spine up one vertebra at a time"],
      "f1-email-4b-power-posture": ["A free exercise for your Hips, Ada", "slide your arms up the wall like a snow angel"],
      "f1-email-4c-spring-step": ["Try this for your Hips — takes 2 minutes", "Let your heels drop below the step level"],
      "f1-email-4c-chronic": ["Try this for your chronic pain — takes 2 minutes", "Let your heels drop below the step level"],
      "f1-email-4d-hand-balancer": ["Try this for your Hips — takes 2 minutes", "creates opposition between your thumb and pinky"],
      "f1-email-5-skeptical": ["I can't help everyone with Hips pain", "The Amari Method doesn't work for everyone."],
      "f1-email-5-chronic": ["I can't help everyone with chronic pain", "The Amari Method doesn't work for everyone."],
      "f1-email-6-when-ready": ["Ada, one last thought about your Hips", "No countdown timer. No manufactured urgency."],
      "f1-email-6-chronic": ["Ada, one last thought about your pain", "No countdown timer. No manufactured urgency."],
    };
    for (const [templateId, [subject, phrase]] of Object.entries(expectations)) {
      const rendered = renderNurtureTemplate(templateId, fields);
      expect(rendered.subject).toBe(subject);
      expect(rendered.body).toContain(phrase);
    }
    expect(renderNurtureTemplate("f1-email-2-chronic", { "contact.first_name": "Ada" }).body)
      .not.toContain("{{");
  });

  it("pins the current Draft Flow 2 Assessment copy without retired pricing", () => {
    const first = renderNurtureTemplate("f2-email-1-good-talking", { "contact.first_name": "Ada" });
    expect(first.subject).toBe("Good talking with you, Ada");
    expect(first.preheader).toBe("Here's what stuck with me from our call.");
    expect(first.body).toContain("a 50-minute, $29 first visit");

    const personalized = renderNurtureTemplate("f2-email-2-personalized", { "contact.first_name": "Ada" });
    const fallback = renderNurtureTemplate("f2-email-2-chronic", { "contact.first_name": "Ada" });
    expect(personalized.subject).toBe("What your Assessment looks like");
    expect(fallback.subject).toBe("What your Assessment looks like");
    expect(personalized.body).toContain("I’m there to guide you through it.");
    expect(fallback.body).toContain("Simple things like walking or reaching");
    expect(`${first.body}\n${personalized.body}\n${fallback.body}`).not.toContain("$225");
    expect(`${first.body}\n${personalized.body}\n${fallback.body}`).not.toContain("initial_session_price");
  });

  it("keeps retired and unowned copy out of the executable catalog", () => {
    const source = JSON.stringify(NURTURE_TEMPLATES);
    expect(source).not.toMatch(/\bDr\.? Garrett\b/i);
    expect(source).not.toContain("f3-email-3-series-pitch");
    expect(source).not.toContain("What your first session actually looks like");
  });

  it("renders the exact owned source with a required native first name", () => {
    const result = renderNurtureTemplate("f3-email-1-protocols-portal", {
      "contact.first_name": "Ada",
    });
    expect(result).toEqual(expect.objectContaining({
      templateId: "f3-email-1-protocols-portal",
      sequenceId: "flow-3-post-initial",
      from: { name: "Garrett", email: "garrett@amarimethod.com" },
      subject: "Your protocols are in the portal, Ada",
      preheader: "Do the protocols. Don't force them.",
    }));
    expect(result.body).toContain("Hi Ada,");
    expect(result.body).toContain("https://www.amarimethod.com/tools");
    expect(result.body).toContain("https://www.amarimethod.com/portal/");
    expect(result.body).not.toContain("{{");
  });

  it("fails closed for unknown templates or a missing merge value", () => {
    expect(() => renderNurtureTemplate("f3-email-3-series-pitch", { "contact.first_name": "Ada" }))
      .toThrow("unowned nurture template");
    expect(() => renderNurtureTemplate("f3-email-2-practice-going", {}))
      .toThrow("missing required nurture merge field: contact.first_name");
  });

  it("derives the Staff preview from the same immutable templates", () => {
    const preview = flow3MessagePreview();
    expect(preview).toHaveLength(2);
    expect(preview[0]).toEqual(expect.objectContaining({
      templateId: "f3-email-1-protocols-portal",
      stepIndex: 0,
      from: "Garrett <garrett@amarimethod.com>",
    }));
    expect(preview[1].subject).toBe("How's the practice going, {{contact.first_name}}?");
  });
});
