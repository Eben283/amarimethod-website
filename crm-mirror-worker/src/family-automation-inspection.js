import { automationFamilyExecutionView } from "../../functions/lib/automation-views.js";

function unavailable(code, label) {
  return {
    configured: false,
    enrollments: [],
    events: [],
    coverage: { enrollmentsTruncated: false, eventsTruncated: false },
    evidence: { source: "owned_automation_d1", gaps: [{ code, label }] },
  };
}

/** Read-only global execution evidence for one registered lifecycle family. */
export async function familyAutomationInspection(automationDb, family) {
  if (!family?.key) throw new Error("automation family is required");
  if (!automationDb) {
    return unavailable(
      "execution_store_unavailable",
      "The owned automation execution store is not connected. No family-wide run conclusion can be made.",
    );
  }
  try {
    return {
      configured: true,
      ...(await automationFamilyExecutionView(automationDb, family)),
      evidence: { source: "owned_automation_d1", gaps: [] },
    };
  } catch {
    return unavailable(
      "execution_store_read_failed",
      "The owned automation execution store could not be read. Definition evidence remains available.",
    );
  }
}
