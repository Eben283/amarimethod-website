import { contactAutomationIdentityView } from "../../functions/lib/automation-views.js";

const UNAVAILABLE_GAP = Object.freeze({
  code: "execution_store_unavailable",
  label: "The owned automation execution store is not connected. No enrollment or run conclusion can be made.",
});

/**
 * One read interface for every Staff surface that needs a person's automation state.
 * It never calls GHL and never infers execution from message timing alone.
 */
export async function personAutomationInspection(automationDb, contact) {
  const contactId = String(contact?.id || "").trim();
  if (!contactId) throw new Error("owned contact id is required");
  const providerContactId = contact?.ghl_contact_id ? String(contact.ghl_contact_id) : null;

  if (!automationDb) {
    return {
      configured: false,
      contactId,
      providerContactId,
      enrollments: [],
      events: [],
      coverage: { eventLimit: 200, eventsTruncated: false },
      evidence: { source: "owned_automation_d1", gaps: [UNAVAILABLE_GAP] },
    };
  }

  try {
    const inspection = await contactAutomationIdentityView(automationDb, {
      ownedContactId: contactId,
      providerContactId,
    });
    return {
      configured: true,
      ...inspection,
      evidence: { source: "owned_automation_d1", gaps: [] },
    };
  } catch {
    return {
      configured: false,
      contactId,
      providerContactId,
      enrollments: [],
      events: [],
      coverage: { eventLimit: 200, eventsTruncated: false },
      evidence: {
        source: "owned_automation_d1",
        gaps: [{
          code: "execution_store_read_failed",
          label: "The owned automation execution store could not be read. The rest of the person record remains available.",
        }],
      },
    };
  }
}
