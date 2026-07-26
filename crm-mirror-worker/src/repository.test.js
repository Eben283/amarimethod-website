import { describe, expect, it } from "vitest";
import { reconciliationStatus } from "./repository.js";

describe("CRM mirror reconciliation status", () => {
  it("reports pending review without exposing purchase details or posting a ledger entry", async () => {
    const db = {
      prepare: () => ({}),
      batch: async () => [
        { results: [{ purchases_total: 4, contact_linked: 1, contact_unlinked: 3, pending_ledger_review: 4, unclassified: 1 }] },
        { results: [{ pending_candidates: 2 }] },
      ],
    };

    await expect(reconciliationStatus(db)).resolves.toEqual({
      purchasesTotal: 4,
      contactLinked: 1,
      contactUnlinked: 3,
      pendingLedgerReview: 4,
      unclassified: 1,
      pendingCandidates: 2,
      automaticLedgerPosting: false,
    });
  });
});
