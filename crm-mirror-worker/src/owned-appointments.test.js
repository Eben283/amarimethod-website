import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  captureOwnedScheduleCommand,
  claimOwnedAppointmentExecution,
  completeOwnedAppointmentExecution,
  failOwnedAppointmentExecution,
  linkOwnedAppointmentProviderRecord,
  OwnedAppointmentError,
  unlinkOwnedAppointmentProviderRecord,
} from "./owned-appointments.js";

const migrationNames = [
  "0001_initial_schema.sql", "0002_purchase_reconciliation_candidates.sql",
  "0003_purchase_classification_review.sql", "0004_ledger_cutover_candidates.sql",
  "0005_shadow_ledger_opening_balances.sql", "0006_staff_communications.sql",
  "0007_ghl_webhook_event_journal.sql", "0008_client_workspace_records.sql",
  "0009_stripe_invoices.sql", "0010_owned_sender_foundation.sql",
  "0011_monitor_readiness_contract.sql", "0012_client_desk_seen.sql",
  "0013_owned_followups.sql", "0014_appointment_projection.sql",
  "0015_owned_communication_commands.sql", "0016_gmail_provider_evidence.sql",
  "0017_gmail_sync_gap_evidence.sql", "0018_gmail_reply_sync_control.sql",
  "0019_owned_appointment_authority.sql",
];

function d1Database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of migrationNames) {
    const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    if (name === "0019_owned_appointment_authority.sql") sqlite.exec(`BEGIN; ${sql} COMMIT;`);
    else sqlite.exec(sql);
  }
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    },
    _run: () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => item._run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function seedContact(db) {
  db.sqlite.exec(`
    INSERT INTO contacts (id, display_name, created_at, updated_at)
    VALUES ('contact-1', 'Partner Person', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')
  `);
}

const input = {
  contactId: "contact-1",
  serviceId: "partner-initial",
  actor: "Garrett",
  idempotencyKey: "partner-session-0001",
  startTime: "2026-09-01T10:00:00-07:00",
  timezone: "America/Los_Angeles",
};

describe("owned appointment authority", () => {
  it("atomically captures a provider-neutral Partner Initial appointment and deduplicates retry", async () => {
    const db = d1Database();
    seedContact(db);
    const options = { nowMs: Date.parse("2026-08-28T00:00:00Z"), providerSyncRequired: true };

    const created = await captureOwnedScheduleCommand(db, input, options);
    expect(created).toMatchObject({
      contactId: "contact-1", serviceId: "partner-initial",
      authority: "owned", providerSyncState: "pending", commandState: "accepted",
      startsAt: "2026-09-01T17:00:00.000Z", endsAt: "2026-09-01T18:00:00.000Z",
      deduped: false,
    });
    expect(created.appointmentId).toMatch(/^appt_/);
    expect(created.commandId).toMatch(/^acmd_/);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_authority_events").get())
      .toEqual({ count: 1 });

    const retried = await captureOwnedScheduleCommand(db, input, options);
    expect(retried).toEqual({ ...created, deduped: true });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
    db.sqlite.close();
  });

  it("fails closed when the occupied block collides or an action key changes meaning", async () => {
    const db = d1Database();
    seedContact(db);
    const options = { nowMs: Date.parse("2026-08-28T00:00:00Z"), providerSyncRequired: false };
    await captureOwnedScheduleCommand(db, input, options);

    await expect(captureOwnedScheduleCommand(db, {
      ...input,
      idempotencyKey: "partner-session-0002",
      startTime: "2026-09-01T11:10:00-07:00",
    }, options)).rejects.toMatchObject({ code: "slot_unavailable", status: 409 });

    await expect(captureOwnedScheduleCommand(db, {
      ...input,
      startTime: "2026-09-02T10:00:00-07:00",
    }, options)).rejects.toBeInstanceOf(OwnedAppointmentError);
    await expect(captureOwnedScheduleCommand(db, {
      ...input,
      startTime: "2026-09-02T10:00:00-07:00",
    }, options)).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
    db.sqlite.close();
  });

  it("leases one executor and checkpoints exact provider linkage before completion", async () => {
    const db = d1Database();
    seedContact(db);
    const nowMs = Date.parse("2026-08-28T00:00:00Z");
    const captured = await captureOwnedScheduleCommand(db, input, { nowMs, providerSyncRequired: true });
    const identity = { commandId: captured.commandId, actor: "Garrett" };

    const claim = await claimOwnedAppointmentExecution(db, identity, { nowMs, leaseMs: 120_000 });
    expect(claim).toMatchObject({ state: "acquired", execution: { attempts: 1, providerRecordId: null } });
    await expect(claimOwnedAppointmentExecution(db, identity, { nowMs: nowMs + 1_000 }))
      .resolves.toMatchObject({ state: "in_progress" });

    const linked = await linkOwnedAppointmentProviderRecord(db, {
      ...identity,
      provider: "ghl",
      providerRecordId: "ghl-appointment-1",
      providerCalendarId: "lfsnaiGiLNL2z12pLKDP",
      providerStatusRaw: "confirmed",
    }, { nowMs: nowMs + 2_000 });
    expect(linked).toMatchObject({ state: "executing", provider: "ghl", providerRecordId: "ghl-appointment-1" });

    const completed = await completeOwnedAppointmentExecution(db, {
      ...identity,
      result: { providerReadback: "confirmed" },
    }, { nowMs: nowMs + 3_000, providerSyncRequired: true });
    expect(completed).toMatchObject({ state: "completed", result: { providerReadback: "confirmed" } });
    expect(db.sqlite.prepare("SELECT provider_appointment_id, provider_sync_state FROM appointments WHERE id = ?")
      .get(captured.appointmentId))
      .toEqual({ provider_appointment_id: "ghl-appointment-1", provider_sync_state: "synced" });
    expect(db.sqlite.prepare("SELECT record_id FROM external_records WHERE provider = 'ghl' AND external_id = ?")
      .get("ghl-appointment-1"))
      .toEqual({ record_id: captured.appointmentId });
    await expect(claimOwnedAppointmentExecution(db, identity, { nowMs: nowMs + 4_000 }))
      .resolves.toMatchObject({ state: "completed" });
    db.sqlite.close();
  });

  it("removes an exact compensated provider link and leaves retryable owned truth", async () => {
    const db = d1Database();
    seedContact(db);
    const nowMs = Date.parse("2026-08-28T00:00:00Z");
    const captured = await captureOwnedScheduleCommand(db, input, { nowMs, providerSyncRequired: true });
    const identity = { commandId: captured.commandId, actor: "Garrett" };
    await claimOwnedAppointmentExecution(db, identity, { nowMs });
    await linkOwnedAppointmentProviderRecord(db, {
      ...identity,
      provider: "ghl",
      providerRecordId: "ghl-appointment-2",
      providerCalendarId: "lfsnaiGiLNL2z12pLKDP",
      providerStatusRaw: "new",
    }, { nowMs: nowMs + 1_000 });
    await unlinkOwnedAppointmentProviderRecord(db, {
      ...identity,
      providerRecordId: "ghl-appointment-2",
    }, { nowMs: nowMs + 2_000 });
    const failed = await failOwnedAppointmentExecution(db, {
      ...identity,
      error: "provider confirmation failed after successful compensation",
      manualReview: false,
    }, { nowMs: nowMs + 3_000 });
    expect(failed).toMatchObject({ state: "retryable", providerRecordId: null });
    expect(db.sqlite.prepare("SELECT provider_appointment_id, provider_sync_state FROM appointments WHERE id = ?")
      .get(captured.appointmentId))
      .toEqual({ provider_appointment_id: null, provider_sync_state: "retryable" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM external_records WHERE external_id = 'ghl-appointment-2'").get())
      .toEqual({ count: 0 });
    await expect(claimOwnedAppointmentExecution(db, identity, { nowMs: nowMs + 4_000 }))
      .resolves.toMatchObject({ state: "acquired", execution: { attempts: 2 } });
    db.sqlite.close();
  });

  it("cancels a provider-free owned reservation when final availability rejects it", async () => {
    const db = d1Database();
    seedContact(db);
    const nowMs = Date.parse("2026-08-28T00:00:00Z");
    const captured = await captureOwnedScheduleCommand(db, input, { nowMs, providerSyncRequired: true });
    const identity = { commandId: captured.commandId, actor: "Garrett" };
    await claimOwnedAppointmentExecution(db, identity, { nowMs });
    const rejected = await failOwnedAppointmentExecution(db, {
      ...identity,
      error: "that time is no longer open on Garrett's schedule",
      terminal: true,
    }, { nowMs: nowMs + 1_000 });
    expect(rejected).toMatchObject({ state: "rejected", providerRecordId: null });
    expect(db.sqlite.prepare("SELECT status, provider_sync_state, cancelled_at FROM appointments WHERE id = ?")
      .get(captured.appointmentId))
      .toEqual({ status: "cancelled", provider_sync_state: "not_required", cancelled_at: "2026-08-28T00:00:01.000Z" });
    await expect(claimOwnedAppointmentExecution(db, identity, { nowMs: nowMs + 2_000 }))
      .resolves.toMatchObject({ state: "rejected" });
    db.sqlite.close();
  });
});
