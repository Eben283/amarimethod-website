import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const readMigration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const foundations = [
  "0001_initial_schema.sql",
  "0002_purchase_reconciliation_candidates.sql",
  "0003_purchase_classification_review.sql",
  "0004_ledger_cutover_candidates.sql",
  "0005_shadow_ledger_opening_balances.sql",
  "0006_staff_communications.sql",
  "0007_ghl_webhook_event_journal.sql",
  "0008_client_workspace_records.sql",
  "0009_stripe_invoices.sql",
  "0010_owned_sender_foundation.sql",
  "0011_monitor_readiness_contract.sql",
  "0012_client_desk_seen.sql",
  "0013_owned_followups.sql",
  "0014_appointment_projection.sql",
  "0015_owned_communication_commands.sql",
  "0016_gmail_provider_evidence.sql",
  "0017_gmail_sync_gap_evidence.sql",
  "0018_gmail_reply_sync_control.sql",
].map(readMigration);
const migration = readMigration("0019_owned_appointment_authority.sql");

describe("owned appointment authority migration", () => {
  it("preserves populated appointment dependents and accepts provider-free owned records", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const foundation of foundations) db.exec(foundation);
    db.exec(`
      INSERT INTO contacts (id, display_name, created_at, updated_at)
      VALUES ('contact-1', 'Person One', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');
      INSERT INTO appointments (
        id, contact_id, service_id, provider_appointment_id,
        provider_calendar_id, provider_status_raw, status, starts_at,
        ends_at, timezone, created_at, updated_at
      ) VALUES (
        'appointment-legacy', 'contact-1', 'partner-initial', 'ghl-appointment-1',
        'lfsnaiGiLNL2z12pLKDP', 'confirmed', 'confirmed', '2026-09-01T17:00:00Z',
        '2026-09-01T18:00:00Z', 'America/Los_Angeles',
        '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z'
      );
      INSERT INTO notes (id, contact_id, appointment_id, body, authored_by, created_at, updated_at)
      VALUES ('note-1', 'contact-1', 'appointment-legacy', 'Keep this link', 'Eben',
              '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');
      INSERT INTO session_ledger_entries (
        id, contact_id, appointment_id, entry_type, credits, reason, created_by, source_key, created_at
      ) VALUES (
        'ledger-1', 'contact-1', 'appointment-legacy', 'attendance_debit', -1,
        'Preserve the appointment reference', 'Eben', 'test:ledger-1', '2026-08-28T00:00:00Z'
      );
    `);

    db.exec("BEGIN");
    db.exec(migration);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.exec("COMMIT");

    expect(db.prepare("SELECT authority, provider_sync_state, revision FROM appointments WHERE id = ?")
      .get("appointment-legacy"))
      .toEqual({ authority: "provider_mirror", provider_sync_state: "synced", revision: 1 });
    expect(db.prepare("SELECT duration_minutes, buffer_minutes, start_interval_minutes FROM services WHERE id = ?")
      .get("partner-initial"))
      .toEqual({ duration_minutes: 60, buffer_minutes: 20, start_interval_minutes: 60 });
    expect(db.prepare("SELECT appointment_id FROM notes WHERE id = 'note-1'").get())
      .toEqual({ appointment_id: "appointment-legacy" });
    expect(db.prepare("SELECT appointment_id FROM session_ledger_entries WHERE id = 'ledger-1'").get())
      .toEqual({ appointment_id: "appointment-legacy" });

    db.prepare(`
      INSERT INTO appointments (
        id, contact_id, service_id, status, starts_at, ends_at, timezone,
        authority, provider_sync_state, revision, created_by, last_modified_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, 'owned', 'pending', 1, ?, ?, ?, ?)
    `).run(
      "appointment-owned", "contact-1", "partner-initial",
      "2026-09-08T17:00:00Z", "2026-09-08T18:00:00Z", "America/Los_Angeles",
      "Garrett", "Garrett", "2026-08-28T01:00:00Z", "2026-08-28T01:00:00Z",
    );
    expect(db.prepare("SELECT provider_appointment_id, authority, provider_sync_state FROM appointments WHERE id = ?")
      .get("appointment-owned"))
      .toEqual({ provider_appointment_id: null, authority: "owned", provider_sync_state: "pending" });
    db.prepare(`
      INSERT INTO appointment_payment_records (
        appointment_id, contact_id, status, method, note, amount_cents,
        source, recorded_by, recorded_at, updated_at
      ) VALUES (?, ?, 'comped', NULL, 'Partner gift', 0, 'manual', 'Garrett', ?, ?)
    `).run("appointment-owned", "contact-1", "2026-08-28T01:05:00Z", "2026-08-28T01:05:00Z");
    expect(db.prepare("SELECT status, note FROM appointment_payment_records WHERE appointment_id = ?")
      .get("appointment-owned"))
      .toEqual({ status: "comped", note: "Partner gift" });
    db.prepare(`
      INSERT INTO appointment_payment_events (
        id, appointment_id, contact_id, status, source, recorded_by, occurred_at
      ) VALUES ('payment-event-1', ?, ?, 'comped', 'manual', 'Garrett', ?)
    `).run("appointment-owned", "contact-1", "2026-08-28T01:05:00Z");
    expect(() => db.exec("DELETE FROM appointment_payment_events WHERE id = 'payment-event-1'"))
      .toThrow(/append-only/i);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("keeps mirrored provider identity required and authority events append-only", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const foundation of foundations) db.exec(foundation);
    db.exec("BEGIN");
    db.exec(migration);
    db.exec("COMMIT");
    db.exec(`
      INSERT INTO contacts (id, display_name, created_at, updated_at)
      VALUES ('contact-1', 'Person One', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');
      INSERT INTO appointments (
        id, contact_id, service_id, status, authority, provider_sync_state,
        created_at, updated_at
      ) VALUES (
        'appointment-owned', 'contact-1', 'partner-initial', 'confirmed', 'owned', 'not_required',
        '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z'
      );
    `);
    expect(() => db.exec(`
      INSERT INTO appointments (
        id, contact_id, status, authority, provider_sync_state, created_at, updated_at
      ) VALUES (
        'invalid-mirror', 'contact-1', 'confirmed', 'provider_mirror', 'synced',
        '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z'
      )
    `)).toThrow(/constraint/i);

    db.exec(`
      INSERT INTO appointment_authority_commands (
        id, actor, idempotency_key, action, contact_id, appointment_id, service_id,
        payload_sha256, state, created_at, updated_at
      ) VALUES (
        'command-1', 'Garrett', 'partner-session-1', 'schedule', 'contact-1',
        'appointment-owned', 'partner-initial', 'hash-1', 'accepted',
        '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z'
      );
      INSERT INTO appointment_authority_events (
        id, command_id, appointment_id, event_type, occurred_at
      ) VALUES (
        'event-1', 'command-1', 'appointment-owned', 'accepted', '2026-08-28T00:00:00Z'
      );
    `);
    expect(() => db.exec("UPDATE appointment_authority_events SET event_type = 'completed' WHERE id = 'event-1'"))
      .toThrow(/append-only/i);
    expect(() => db.exec("DELETE FROM appointment_authority_events WHERE id = 'event-1'"))
      .toThrow(/append-only/i);
    db.close();
  });
});
