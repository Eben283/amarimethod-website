import { describe, expect, it } from "vitest";
import { automationFamily } from "../../functions/lib/automation-families.js";
import { familyAutomationInspection } from "./family-automation-inspection.js";

const emptyAutomationDb = {
  prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
};

describe("family automation inspection", () => {
  const family = automationFamily("initial-session-reminders");

  it("reports unavailable without inventing global execution evidence", async () => {
    const result = await familyAutomationInspection(null, family);
    expect(result).toMatchObject({ configured: false, enrollments: [], events: [] });
    expect(result.evidence.gaps[0].code).toBe("execution_store_unavailable");
  });

  it("reads the exact family's owned execution rows through one interface", async () => {
    const result = await familyAutomationInspection(emptyAutomationDb, family);
    expect(result).toMatchObject({
      configured: true,
      enrollments: [],
      events: [],
      coverage: { enrollmentsTruncated: false, eventsTruncated: false },
      evidence: { source: "owned_automation_d1", gaps: [] },
    });
  });
});
