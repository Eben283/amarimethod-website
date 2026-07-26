import { describe, expect, it } from "vitest";
import { reconciliationReview, reconciliationStatus } from "./repository.js";

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

describe("CRM mirror reconciliation review", () => {
  it("keeps candidates, unmatched purchases, and classification exceptions separate", async () => {
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [
        { results: [{ provider_charge_id: "ch_candidate" }] },
        { results: [{ provider_charge_id: "ch_unmatched" }] },
        { results: [{ provider_charge_id: "ch_unclassified" }] },
        { results: [{ id: "four-session-series", name: "4-Session Series" }] },
      ],
    };
    await expect(reconciliationReview(db, 25)).resolves.toEqual({
      candidates: [{ provider_charge_id: "ch_candidate" }],
      unmatched: [{ provider_charge_id: "ch_unmatched" }],
      unclassified: [{ provider_charge_id: "ch_unclassified" }],
      packages: [{ id: "four-session-series", name: "4-Session Series" }],
    });
  });
});
