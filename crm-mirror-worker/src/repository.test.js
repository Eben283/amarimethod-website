import { describe, expect, it } from "vitest";
import { activeClientOperations, classifyPurchase, contactProfile, decideLedgerCutoverCandidate, ledgerCutoverReview, reconciliationReview, reconciliationStatus, searchContacts, syncHealthForRuns, upsertGhlContact, upsertStripeCharge } from "./repository.js";

describe("CRM mirror GHL contact last_seen", () => {
  it("refreshes external_records.last_seen_at when an existing contact is re-imported", async () => {
    const writes = [];
    const db = {
      prepare: (sql) => ({
        bind: (...values) => ({
          first: async () => (
            sql.includes("SELECT contact_id FROM external_records")
              ? { contact_id: "contact_1" }
              : null
          ),
          run: async () => { writes.push({ sql, values }); },
        }),
      }),
      batch: async (statements) => { writes.push(...statements.map((s) => ({ sql: "batch", values: s }))); },
    };

    await upsertGhlContact(db, {
      externalId: "ghl_1",
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      phone: null,
      referralSourceLabel: null,
      tags: [],
      roles: [],
      attributes: [],
    }, "2026-07-28T19:00:00.000Z");

    expect(writes.some((w) => typeof w.sql === "string" && w.sql.includes("UPDATE contacts"))).toBe(true);
    const externalUpsert = writes.find((w) => typeof w.sql === "string" && w.sql.includes("INSERT INTO external_records") && w.sql.includes("ON CONFLICT"));
    expect(externalUpsert).toBeTruthy();
    expect(externalUpsert.values).toEqual(expect.arrayContaining(["ghl_1", "contact_1", "2026-07-28T19:00:00.000Z"]));
  });
});

describe("CRM mirror sync health", () => {
  it("reports independent provider health and accepts an in-progress bounded GHL page", () => {
    const health = syncHealthForRuns({
      ghl: { status: "partial", finished_at: "2026-07-27T12:00:00.000Z" },
      stripe: { status: "succeeded", finished_at: "2026-07-27T11:50:00.000Z" },
    }, "2026-07-27T12:15:00.000Z");
    expect(health).toMatchObject({ overall: "healthy" });
    expect(health.providers.ghl).toMatchObject({ state: "healthy", ageMinutes: 15 });
    expect(health.providers.stripe).toMatchObject({ state: "healthy", ageMinutes: 25 });
  });

  it("flags failed and never-run sources instead of hiding them behind the latest run", () => {
    const health = syncHealthForRuns({
      ghl: { status: "failed", finished_at: "2026-07-27T12:00:00.000Z" },
      stripe: null,
    }, "2026-07-27T13:00:00.000Z");
    expect(health.overall).toBe("failed");
    expect(health.providers.ghl.state).toBe("failed");
    expect(health.providers.stripe.state).toBe("missing");
  });
});

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

  it("does not let a later Stripe import erase a reviewed legacy classification", async () => {
    const writes = [];
    const db = {
      prepare: (sql) => ({
        bind: (...values) => ({
          first: async () => sql.startsWith("SELECT id, contact_id")
            ? { id: "purchase_1", contact_id: "contact_1", package_id: null, classification: "Legacy package — pre-current pricing", classification_review_state: "confirmed" }
            : null,
          all: async () => ({ results: [] }),
          run: async () => { writes.push({ sql, values }); },
        }),
      }),
    };
    await upsertStripeCharge(db, {
      externalId: "charge_1", contactExternalId: null, packageId: null, customerExternalId: null,
      providerStatus: "succeeded", amountCents: 20000, amountRefundedCents: 0, currency: "usd",
      purchasedAt: "2026-07-27T00:00:00.000Z", classification: "unclassified", billingEmail: null,
    }, "2026-07-27T00:00:00.000Z");
    const purchaseUpdate = writes.find((write) => write.sql.startsWith("UPDATE purchases"));
    expect(purchaseUpdate.values[1]).toBe(null);
    expect(purchaseUpdate.values[8]).toBe("Legacy package — pre-current pricing");
  });
});

describe("CRM mirror client profiles", () => {
  it("keeps contact search and a read-only profile separate from the session ledger", async () => {
    const searchDb = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: "contact_1", display_name: "Eben" }] }) }) }),
    };
    await expect(searchContacts(searchDb, "Eben", 25)).resolves.toEqual([{ id: "contact_1", display_name: "Eben" }]);
    await expect(searchContacts(searchDb, null, 25)).resolves.toEqual([]);

    const profileDb = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [
        { results: [{ id: "contact_1", display_name: "Eben" }] },
        { results: [{ tag: "client" }] },
        { results: [{ role: "client" }] },
        { results: [{ sessions_remaining: "3", series_type: "8-session" }] },
        { results: [{ starts_at: "2026-07-27 13:00:00" }] },
        { results: [{ status: "confirmed" }] },
        { results: [{ classification: "8-Session Series" }] },
      ],
    };
    await expect(contactProfile(profileDb, "contact_1", 25, "2026-07-26T00:00:00.000Z")).resolves.toMatchObject({
      contact: { id: "contact_1", display_name: "Eben" },
      tags: ["client"],
      roles: ["client"],
      importedCurrentState: { sessions_remaining: "3", series_type: "8-session" },
      nextAppointment: { starts_at: "2026-07-27 13:00:00" },
      appointments: [{ status: "confirmed" }],
      purchases: [{ classification: "8-Session Series" }],
    });
  });
});

describe("CRM mirror ledger cutover review", () => {
  it("shows proposed opening balances without creating a ledger entry", async () => {
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [
        { results: [{ candidate_id: "cutover_1", proposed_credits: 3 }] },
        { results: [{ pending: 1, approved: 0, rejected: 0 }] },
        { results: [{ opening_entries: 0 }] },
      ],
    };
    await expect(ledgerCutoverReview(db, 25)).resolves.toEqual({
      candidates: [{ candidate_id: "cutover_1", proposed_credits: 3 }],
      pending: 1,
      approved: 0,
      rejected: 0,
      shadowOnly: true,
      shadowOpeningEntries: 0,
    });
  });

  it("approves a candidate with an audit event but no ledger entry", async () => {
    const writes = [];
    const db = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => sql.startsWith("SELECT id") ? { id: "cutover_1", contact_id: "contact_1", proposed_credits: 3, state: "pending_review" } : null,
          run: async () => { writes.push(sql); },
        }),
      }),
    };
    await expect(decideLedgerCutoverCandidate(db, "cutover_1", "approve", "Eben", "2026-07-26T00:00:00.000Z")).resolves.toEqual({
      candidateId: "cutover_1", decision: "approve", state: "approved", ledgerEntryCreated: false,
    });
    expect(writes).toHaveLength(2);
    expect(writes.join(" ")).not.toContain("session_ledger_entries");
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
