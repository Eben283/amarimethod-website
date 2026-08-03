import { describe, expect, it } from "vitest";
import { activeClientOperations, classifyPurchase, clientDeskContacts, communicationsInbox, contactProfile, decideLedgerCutoverCandidate, dropAbsentGhlContacts, ledgerCutoverReview, reconciliationReview, reconciliationStatus, searchContacts, syncHealthForRuns, upsertGhlContact, upsertStripeCharge } from "./repository.js";

describe("CRM mirror absent GHL contacts", () => {
  it("removes external_records for contacts confirmed deleted in GHL", async () => {
    const deleted = [];
    const db = {
      prepare: (sql) => ({
        bind: (...values) => ({
          all: async () => ({ results: [{ external_id: "gone" }, { external_id: "alive" }] }),
          run: async () => { deleted.push({ sql, values }); },
        }),
      }),
    };

    const dropped = await dropAbsentGhlContacts(db, "2026-07-29T07:30:00.000Z", async (id) => id === "alive");
    expect(dropped).toBe(1);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].values).toEqual(["gone"]);
    expect(deleted[0].sql).toContain("DELETE FROM external_records");
  });
});

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
  it("keeps known machine-status traffic out of the client inbox", async () => {
    const calls = [];
    const db = {
      prepare: (sql) => ({ bind: (...values) => ({ all: async () => { calls.push({ sql, values }); return { results: [] }; } }) }),
    };
    await expect(communicationsInbox(db, { limit: 25 })).resolves.toEqual([]);
    expect(calls[0].sql).toContain("NOT EXISTS");
    expect(calls[0].sql).toContain("UPPER(TRIM(COALESCE(operational_event.body_clean, ''))) LIKE 'OPS-%'");
    expect(calls[0].sql).toContain("%local codex exit%");
    expect(calls[0].sql).toContain("%github branch-creation%");
  });

  it("keeps contact search and a read-only profile separate from the session ledger", async () => {
    const profileQueries = [];
    const searchDb = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: "contact_1", display_name: "Eben" }] }) }) }),
    };
    await expect(searchContacts(searchDb, "Eben", 25)).resolves.toEqual([{ id: "contact_1", display_name: "Eben" }]);
    await expect(searchContacts(searchDb, null, 25)).resolves.toEqual([]);

    const profileDb = {
      prepare: (sql) => { profileQueries.push(sql); return { bind: () => ({}) }; },
      batch: async () => [
        { results: [{ id: "contact_1", display_name: "Eben" }] },
        { results: [{ tag: "client" }] },
        { results: [{ role: "client" }] },
        { results: [{ attribute_key: "series", attribute_value: "8-session" }] },
        { results: [{ sessions_remaining: "3", series_type: "8-session" }] },
        { results: [{ starts_at: "2026-07-27 13:00:00" }] },
        { results: [{ status: "confirmed" }] },
        { results: [{ direction: "inbound", subject_or_preview: "Can we reschedule?" }] },
        { results: [{ direction: "inbound", body_clean: "Can we reschedule?" }] },
        { results: [{ classification: "8-Session Series" }] },
        { results: [{ invoice_number: "AMARI-001", provider_status: "open", amount_due_cents: 34700 }] },
        { results: [{ body: "Call before next session" }] },
        { results: [{ title: "Follow up", status: "open" }] },
        { results: [{ channel: "sms", state: "granted" }] },
        { results: [{ activity_type: "message", body: "Can we reschedule?" }] },
        { results: [] },
        { results: [] },
        { results: [] },
        { results: [] },
        { results: [] },
      ],
    };
    await expect(contactProfile(profileDb, "contact_1", 25, "2026-07-26T00:00:00.000Z")).resolves.toMatchObject({
      contact: { id: "contact_1", display_name: "Eben" },
      invoices: [{ invoice_number: "AMARI-001", provider_status: "open", amount_due_cents: 34700 }],
      tags: ["client"],
      roles: ["client"],
      importedCurrentState: { sessions_remaining: "3", series_type: "8-session" },
      nextAppointment: { starts_at: "2026-07-27 13:00:00" },
      appointments: [{ status: "confirmed" }],
      purchases: [{ classification: "8-Session Series" }],
      communications: [{ direction: "inbound", subject_or_preview: "Can we reschedule?" }],
      notes: [{ body: "Call before next session" }],
      tasks: [{ title: "Follow up", status: "open" }],
      consents: [{ channel: "sms", state: "granted" }],
      activityTimeline: [{ activity_type: "message", body: "Can we reschedule?" }],
    });
    expect(profileQueries.filter((sql) => sql.includes("communication_events event")).join("\n")).toContain("NOT (\n    UPPER(TRIM(COALESCE(event.body_clean, ''))) LIKE 'OPS-%'");
  });

  it("returns a bounded client directory with the latest communication only", async () => {
    const calls = [];
    const db = {
      prepare: (sql) => ({ bind: (...values) => ({ all: async () => { calls.push({ sql, values }); return { results: [{ id: "contact_1", last_direction: "inbound", last_preview: "Hello" }] }; } }) }),
    };
    await expect(clientDeskContacts(db, { query: "Eben", limit: 12, scope: "clients" })).resolves.toEqual([{ id: "contact_1", last_direction: "inbound", last_preview: "Hello" }]);
    expect(calls[0].sql).toContain("communications communication");
    expect(calls[0].sql).toContain("EXISTS (SELECT 1 FROM appointments");
    expect(calls[0].values.at(-1)).toBe(12);
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
