import { describe, expect, it } from "vitest";
import { personAutomationInspection } from "./person-automation-inspection.js";

const emptyAutomationDb = {
  prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
};

describe("person automation inspection", () => {
  it("fails honestly when the owned execution store is not connected", async () => {
    await expect(personAutomationInspection(null, {
      id: "owned_person_1",
      ghl_contact_id: "legacy_ghl_1",
    })).resolves.toEqual({
      configured: false,
      contactId: "owned_person_1",
      providerContactId: "legacy_ghl_1",
      enrollments: [],
      events: [],
      coverage: { eventLimit: 200, eventsTruncated: false },
      evidence: {
        source: "owned_automation_d1",
        gaps: [{
          code: "execution_store_unavailable",
          label: "The owned automation execution store is not connected. No enrollment or run conclusion can be made.",
        }],
      },
    });
  });

  it("reads owned and former-provider identities through one person interface", async () => {
    const result = await personAutomationInspection(emptyAutomationDb, {
      id: "owned_person_1",
      ghl_contact_id: "legacy_ghl_1",
    });

    expect(result).toMatchObject({
      configured: true,
      contactId: "owned_person_1",
      providerContactId: "legacy_ghl_1",
      automationContactIds: ["owned_person_1", "legacy_ghl_1"],
      enrollments: [],
      events: [],
      evidence: { source: "owned_automation_d1", gaps: [] },
    });
  });

  it("contains an execution-store read failure so the rest of the person record remains usable", async () => {
    const brokenDb = { prepare: () => { throw new Error("D1 unavailable"); } };
    const result = await personAutomationInspection(brokenDb, { id: "owned_person_1", ghl_contact_id: null });

    expect(result.configured).toBe(false);
    expect(result.enrollments).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.evidence.gaps[0].code).toBe("execution_store_read_failed");
  });
});
