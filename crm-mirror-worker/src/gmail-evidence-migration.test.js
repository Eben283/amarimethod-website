import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = [
  "../migrations/0001_initial_schema.sql",
  "../migrations/0006_staff_communications.sql",
  "../migrations/0010_owned_sender_foundation.sql",
  "../migrations/0015_owned_communication_commands.sql",
  "../migrations/0016_gmail_provider_evidence.sql",
];

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const relative of MIGRATIONS) db.exec(readFileSync(new URL(relative, import.meta.url), "utf8"));
  db.prepare("INSERT INTO contacts (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("contact-1", "Surrina", "2026-08-08T18:00:00.000Z", "2026-08-08T18:00:00.000Z");
  return db;
}

describe("Gmail provider evidence migration", () => {
  it("creates append-only provider, inbound, cursor, and review evidence", () => {
    const db = migratedDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'gmail_%' ORDER BY name",
    ).all().map((row) => row.name);

    expect(tables).toEqual([
      "gmail_evidence_reviews",
      "gmail_history_observations",
      "gmail_inbound_messages",
      "gmail_provider_events",
      "gmail_provider_submissions",
    ]);

    const columns = tables.flatMap((table) => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    expect(columns).not.toContain("access_token");
    expect(columns).not.toContain("refresh_token");
    expect(columns).not.toContain("oauth_grant");
    expect(columns).not.toContain("id_token");

    const appendOnlyTriggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'gmail_%_no_%' ORDER BY name",
    ).all().map((row) => row.name);
    expect(appendOnlyTriggers).toEqual(expect.arrayContaining([
      "gmail_evidence_reviews_no_delete",
      "gmail_evidence_reviews_no_update",
      "gmail_history_observations_no_delete",
      "gmail_history_observations_no_update",
      "gmail_inbound_messages_no_delete",
      "gmail_inbound_messages_no_update",
      "gmail_provider_events_no_delete",
      "gmail_provider_events_no_update",
      "gmail_provider_submissions_no_delete",
      "gmail_provider_submissions_no_update",
    ]));

    const now = "2026-08-08T18:00:00.000Z";
    db.prepare(
      `INSERT INTO gmail_history_observations
       (id, mailbox_actor, grant_owner, mailbox_address, history_id, observed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("history-1", "Eben", "eben@amarimethod.com", "eben@amarimethod.com", "123", now, now);
    expect(() => db.prepare(
      `INSERT INTO gmail_history_observations
       (id, mailbox_actor, grant_owner, mailbox_address, history_id, observed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("history-crossed", "Eben", "garrett@amarimethod.com", "garrett@amarimethod.com", "124", now, now))
      .toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("UPDATE gmail_history_observations SET history_id = '124' WHERE id = 'history-1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM gmail_history_observations WHERE id = 'history-1'").run())
      .toThrow(/append-only/);

    db.prepare(
      `INSERT INTO communication_events
       (id, contact_id, provider, provider_event_id, event_kind, direction, occurred_at, created_at, updated_at)
       VALUES (?, ?, 'gmail', ?, 'email', 'inbound', ?, ?, ?)`,
    ).run("gmail-comm-1", "contact-1", "eben@amarimethod.com:message-1", now, now, now);
    expect(() => db.prepare("UPDATE communication_events SET delivery_status = 'read' WHERE id = 'gmail-comm-1'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM communication_events WHERE id = 'gmail-comm-1'").run())
      .toThrow(/append-only/);

    db.prepare(
      `INSERT INTO gmail_provider_submissions
       (id, mailbox_actor, grant_owner, submission_ref, contact_id, provider_message_id, submitted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("submission-1", "Eben", "eben@amarimethod.com", "submission-1", "contact-1", "message-1", now, now);
    expect(() => db.prepare(
      `INSERT INTO gmail_provider_events
       (id, mailbox_actor, grant_owner, provider_event_id, outcome, provider_message_id, submission_ref,
        submission_id, contact_id, payload_sha256, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("outcome-bad", "Eben", "eben@amarimethod.com", "event-bad", "accepted", "different-message",
      "submission-1", "submission-1", "contact-1", "a".repeat(64), now, now))
      .toThrow(/does not match submission proof/);
    expect(() => db.prepare(
      `INSERT INTO gmail_provider_events
       (id, mailbox_actor, grant_owner, provider_event_id, outcome, contact_id, payload_sha256, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("outcome-no-proof", "Eben", "eben@amarimethod.com", "event-no-proof", "accepted", "contact-1",
      "b".repeat(64), now, now))
      .toThrow(/requires submission proof/);
  });
});
