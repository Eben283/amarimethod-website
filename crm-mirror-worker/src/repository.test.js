import { describe, expect, it } from "vitest";
import { activeClientOperations, classifyPurchase, reconciliationReview, reconciliationStatus } from "./repository.js";

describe("CRM mirror active-client operations", () => {
  it("returns imported balance and upcoming-appointment views without creating a ledger", async () => {
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [
        { results: [{ contact_id: "c_1", sessions_remaining: "3", series_type: "8-session" }] },
        { results: [{ appointment_id: "a_1", status: "confirmed" }] },
        { results: [{ active_clients: 1, upcoming_appointments: 1 }] },
      ],
    };

    await expect(activeClientOperations(db, 25, "2026-07-26T00:00:00.000Z")).resolves.toEqual({
      balanceSource: "ghl_imported_fields",
      automaticLedgerPosting: false,
      totalActiveClients: 1,
      totalUpcomingAppointments: 1,
      activeClients: [{ contact_id: "c_1", sessions_remaining: "3", series_type: "8-session" }],
      upcomingAppointments: [{ appointment_id: "a_1", status: "confirmed" }],
    });
  });
});

describe("CRM mirror historical package classification", () => {
  it("records a legacy package without assigning a current package or session balance", async () => {
    const writes = [];
    const db = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => sql.includes("SELECT id, classification") ? { id: "purchase_1", classification: "unclassified" } : null,
          run: async () => { writes.push(sql); },
        }),
      }),
    };

    await expect(classifyPurchase(
      db, "purchase_1", "legacy_package", null, "Eben", "2026-07-26T00:00:00.000Z",
    )).resolves.toEqual({
      purchaseId: "purchase_1",
      classification: "Legacy package — pre-current pricing",
      reviewState: "confirmed",
      packageId: null,
    });
    expect(writes).toHaveLength(2);
  });
});

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
