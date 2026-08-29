import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = Array.from({ length: 21 }, (_, index) => {
  const prefix = String(index + 1).padStart(4, "0");
  const names = {
    "0001": "initial_schema", "0002": "purchase_reconciliation_candidates",
    "0003": "purchase_classification_review", "0004": "ledger_cutover_candidates",
    "0005": "shadow_ledger_opening_balances", "0006": "staff_communications",
    "0007": "ghl_webhook_event_journal", "0008": "client_workspace_records",
    "0009": "stripe_invoices", "0010": "owned_sender_foundation",
    "0011": "monitor_readiness_contract", "0012": "client_desk_seen",
    "0013": "owned_followups", "0014": "appointment_projection",
    "0015": "owned_communication_commands", "0016": "gmail_provider_evidence",
    "0017": "gmail_sync_gap_evidence", "0018": "gmail_reply_sync_control",
    "0019": "owned_appointment_authority", "0020": "owned_appointment_lifecycle_dispatch",
    "0021": "provider_neutral_calendar_authority",
  };
  return `${prefix}_${names[prefix]}.sql`;
});

function apply(db, name) {
  const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
  if (name.startsWith("0019_")) db.exec(`BEGIN; ${sql} COMMIT;`);
  else db.exec(sql);
}

describe("provider-neutral calendar authority migration", () => {
  it("preserves populated GHL dispatches and admits Google dispatches without provider contacts", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrations.slice(0, 20).forEach((name) => apply(db, name));
    db.exec(`
      INSERT INTO contacts (id, display_name, created_at, updated_at)
      VALUES ('contact-1', 'Synthetic', '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z');
      INSERT INTO appointments (
        id, contact_id, service_id, provider_appointment_id, provider_calendar_id,
        provider_status_raw, status, starts_at, ends_at, timezone, authority,
        provider_sync_state, revision, created_by, last_modified_by, created_at, updated_at
      ) VALUES (
        'appointment-1', 'contact-1', 'partner-initial', 'ghl-appointment-1',
        'lfsnaiGiLNL2z12pLKDP', 'confirmed', 'confirmed', '2026-09-01T17:00:00Z',
        '2026-09-01T18:00:00Z', 'America/Los_Angeles', 'owned', 'synced', 1,
        'Garrett', 'Garrett', '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z'
      );
      INSERT INTO appointment_authority_commands (
        id, actor, idempotency_key, action, contact_id, appointment_id, service_id,
        requested_start_time, requested_end_time, requested_timezone, payload_sha256,
        state, provider, provider_record_id, attempts, lease_until, created_at, updated_at
      ) VALUES (
        'command-1', 'Garrett', 'migration-proof', 'schedule', 'contact-1', 'appointment-1',
        'partner-initial', '2026-09-01T17:00:00Z', '2026-09-01T18:00:00Z',
        'America/Los_Angeles', '${"a".repeat(64)}', 'completed', 'ghl', 'ghl-appointment-1',
        1, 0, '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z'
      );
      INSERT INTO appointment_lifecycle_dispatches (
        id, command_id, appointment_id, contact_id, service_id, provider,
        provider_contact_id, provider_appointment_id, provider_calendar_id,
        event_type, start_at, payload_sha256, state, attempts, lease_until,
        created_at, updated_at
      ) VALUES (
        'dispatch-1', 'command-1', 'appointment-1', 'contact-1', 'partner-initial', 'ghl',
        'ghl-contact-1', 'ghl-appointment-1', 'lfsnaiGiLNL2z12pLKDP', 'confirmed',
        '2026-09-01T17:00:00Z', '${"b".repeat(64)}', 'pending', 0, 0,
        '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z'
      );
    `);

    apply(db, migrations[20]);
    expect(db.prepare(
      "SELECT provider, provider_contact_id, provider_appointment_id, state FROM appointment_lifecycle_dispatches",
    ).get()).toEqual({
      provider: "ghl", provider_contact_id: "ghl-contact-1",
      provider_appointment_id: "ghl-appointment-1", state: "pending",
    });
    expect(db.prepare("PRAGMA table_info(appointment_authority_commands)").all()
      .some((column) => column.name === "provider_calendar_id")).toBe(true);

    db.prepare(`
      UPDATE appointment_lifecycle_dispatches
         SET provider = 'google_calendar', provider_contact_id = NULL,
             provider_appointment_id = 'google-event-1',
             provider_calendar_id = 'garrett@group.calendar.google.com'
       WHERE id = 'dispatch-1'
    `).run();
    expect(db.prepare("SELECT provider, provider_contact_id FROM appointment_lifecycle_dispatches").get())
      .toEqual({ provider: "google_calendar", provider_contact_id: null });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});
