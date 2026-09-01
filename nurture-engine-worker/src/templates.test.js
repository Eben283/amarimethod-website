import { describe, expect, it } from "vitest";
import {
  FLOW_3_POST_INITIAL_TEMPLATES,
  flow3MessagePreview,
  getNurtureTemplate,
  renderNurtureTemplate,
} from "./templates.js";

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
