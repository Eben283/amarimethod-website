import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = [
  "../migrations/0001_initial_schema.sql",
  "../migrations/0006_staff_communications.sql",
  "../migrations/0010_owned_sender_foundation.sql",
  "../migrations/0015_owned_communication_commands.sql",
];

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const relative of MIGRATIONS) db.exec(readFileSync(new URL(relative, import.meta.url), "utf8"));
  db.prepare("INSERT INTO contacts (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("contact-1", "Surrina", "2026-08-08T18:00:00.000Z", "2026-08-08T18:00:00.000Z");
  return db;
}

describe("owned communication ledger migration", () => {
  it("enforces append-only commands, outcomes, and owned Communication references", () => {
    const db = migratedDb();
    db.prepare(
      `INSERT INTO outbound_delivery_attempts
       (id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at,
        idempotency_key, message_ref, body_clean, dnd_state, delivery_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("cmd-1", "contact-1", "Eben", "sms", "unassigned", "unknown", "eligible", "a".repeat(64), "2026-08-08T18:00:00.000Z",
      "desk:contact-1:sms:test", "msg-1", "Checking in", "off", "not_sent_delivery_unavailable");
    db.prepare("INSERT INTO outbound_delivery_events (id, attempt_id, event_type, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?)")
      .run("outcome-1", "cmd-1", "not_sent_delivery_unavailable", "{}", "2026-08-08T18:00:00.000Z");
    db.prepare(
      `INSERT INTO communication_events
       (id, contact_id, provider, provider_event_id, event_kind, direction, delivery_status, body_clean, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("comm-owned", "contact-1", "owned_outbox", "msg-1", "sms", "outbound", "not_sent_delivery_unavailable", "Checking in",
      "2026-08-08T18:00:00.000Z", "2026-08-08T18:00:00.000Z", "2026-08-08T18:00:00.000Z");

    expect(() => db.prepare("UPDATE outbound_delivery_attempts SET policy_state = 'blocked' WHERE id = 'cmd-1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM outbound_delivery_attempts WHERE id = 'cmd-1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("UPDATE outbound_delivery_events SET detail_json = '{\"changed\":true}' WHERE id = 'outcome-1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM outbound_delivery_events WHERE id = 'outcome-1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("UPDATE communication_events SET delivery_status = 'delivered' WHERE id = 'comm-owned'").run())
      .toThrow(/append-only/);

    db.prepare(
      `INSERT INTO communication_events
       (id, contact_id, provider, provider_event_id, event_kind, direction, delivery_status, body_clean, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("comm-ghl", "contact-1", "ghl", "ghl-1", "sms", "outbound", "sent", "Provider mirror",
      "2026-08-08T18:00:00.000Z", "2026-08-08T18:00:00.000Z", "2026-08-08T18:00:00.000Z");
    expect(db.prepare("UPDATE communication_events SET delivery_status = 'delivered' WHERE id = 'comm-ghl'").run().changes).toBe(1);
  });
});
