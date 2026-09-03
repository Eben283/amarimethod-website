import { describe, expect, it } from "vitest";
import { INITIAL_IN_PERSON_WORKFLOW } from "./initial-in-person-workflow.js";
import { INITIAL_VIRTUAL_WORKFLOW } from "./initial-virtual-workflow.js";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";
import { REMINDER_FAMILY_CONTRACTS, validateReminderFamilyContract } from "./reminder-family-contracts.js";
import { sourceProvenance } from "./source-provenance.js";

const families = [
  INITIAL_IN_PERSON_WORKFLOW,
  INITIAL_VIRTUAL_WORKFLOW,
  FOLLOW_UP_WORKFLOW,
];

describe("automation-exit contract recovery", () => {
  it.each(families)("%s.id has a complete shadow-safe contract", (workflow) => {
    expect(validateReminderFamilyContract(workflow, REMINDER_FAMILY_CONTRACTS[workflow.id])).toEqual([]);
  });

  it("requires Follow-Up to carry a separate Normal-event ingress predicate", () => {
    expect(REMINDER_FAMILY_CONTRACTS["follow-up-session-reminders"].requiredIngress).toContain("appointmentEventType");
    expect(FOLLOW_UP_WORKFLOW.trigger.eventTypes).toEqual(["normal"]);
  });

  it("never represents an unbound deployment claim as provenance", () => {
    expect(sourceProvenance({}, "follow-up-session-reminders", 2)).toMatchObject({
      state: "unbound", sourceRevision: null, workerVersion: null,
    });
  });

  it("records a bound cloud release only with both source and Worker identifiers", () => {
    expect(sourceProvenance({ SOURCE_REVISION: "a4d52204", WORKER_VERSION: "fc7eb4e4-ffb8-4a6a-82a3-3171ddf0b6a8" }, "follow-up-session-reminders", 2)).toMatchObject({
      state: "bound", sourceRevision: "a4d52204", workerVersion: "fc7eb4e4-ffb8-4a6a-82a3-3171ddf0b6a8",
    });
  });
});
