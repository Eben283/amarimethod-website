import { describe, expect, it } from "vitest";
import { INITIAL_IN_PERSON, INITIAL_IN_PERSON_WORKFLOW } from "./initial-in-person-workflow.js";
import { INITIAL_VIRTUAL, INITIAL_VIRTUAL_WORKFLOW } from "./initial-virtual-workflow.js";
import { STAFF_MANAGED_WORKFLOW_IDS } from "./index.js";
import { defineWorkflow } from "./workflow-definition.js";
import { NO_SHOW_RECOVERY, NO_SHOW_RECOVERY_WORKFLOW } from "./no-show-recovery-workflow.js";

describe("canonical workflow definition", () => {
  it("allows Staff to draft and publish the staged Initial Virtual definition", () => {
    expect(STAFF_MANAGED_WORKFLOW_IDS).toContain("initial-virtual");
  });

  it("derives the executable Initial-session flow from the document Staff reads", () => {
    expect(INITIAL_IN_PERSON.flowKey).toBe(INITIAL_IN_PERSON_WORKFLOW.id);
    expect(INITIAL_IN_PERSON.definitionVersion).toBe(INITIAL_IN_PERSON_WORKFLOW.version);
    expect(INITIAL_IN_PERSON.steps).toEqual(INITIAL_IN_PERSON_WORKFLOW.nodes.filter((node) => node.at !== "reschedule").map((node) => ({
      at: node.at, type: node.action.type, template: node.action.template, skipIfPast: node.skipIfPast,
    })));
    expect(INITIAL_IN_PERSON.workflowDocument).toBe(INITIAL_IN_PERSON_WORKFLOW);
    expect(Object.isFrozen(INITIAL_IN_PERSON_WORKFLOW)).toBe(true);
    expect(INITIAL_IN_PERSON_WORKFLOW.version).toBe(4);
    expect(INITIAL_IN_PERSON_WORKFLOW.nodes.find((node) => node.at === "reschedule")?.action.template).toBe("reschedule-confirmation");
  });

  it("keeps Initial Virtual executable reminders separate from its one reschedule notice", () => {
    expect(INITIAL_VIRTUAL.definitionVersion).toBe(5);
    expect(INITIAL_VIRTUAL.steps).toEqual(INITIAL_VIRTUAL_WORKFLOW.nodes.filter((node) => node.at !== "reschedule").map((node) => ({
      at: node.at, type: node.action.type, template: node.action.template, skipIfPast: node.skipIfPast,
    })));
    expect(INITIAL_VIRTUAL.steps).toHaveLength(6);
    expect(INITIAL_VIRTUAL_WORKFLOW.nodes.find((node) => node.at === "reschedule")?.action.template).toBe("reschedule-confirmation");
  });

  it("rejects incomplete and duplicate-node documents", () => {
    expect(() => defineWorkflow({ id: "x", name: "X", version: 1, trigger: { calendarIds: ["c"] }, exits: [], nodes: [] })).toThrow("at least one node");
    const node = { id: "step", label: "Step", at: "enroll", action: { type: "email", template: "copy" }, message: { channel: "email", audience: "client", subject: "Hello", body: "Hello" } };
    expect(() => defineWorkflow({ id: "x", name: "X", version: 1, trigger: { calendarIds: ["c"] }, exits: [], nodes: [node, node] })).toThrow("duplicate");
  });

  it("supports post-enrollment timing and derives contact-scoped exit behavior", () => {
    expect(NO_SHOW_RECOVERY_WORKFLOW.nodes.map((node) => node.at)).toContain("enroll+1440m");
    expect(NO_SHOW_RECOVERY.exitOn).toEqual(["confirmed"]);
    expect(NO_SHOW_RECOVERY.steps.every((step) => step.when)).toBe(true);
  });
});
