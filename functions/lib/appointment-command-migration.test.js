import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../db/appointment-commands-migration.sql", import.meta.url), "utf8");

describe("appointment command migration", () => {
  it("creates durable commands and immutable audit events", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(migration);
    db.prepare(`INSERT INTO appointment_commands
      (id, actor, idempotency_key, action, contact_id, source_appointment_id,
       status, lease_until, attempts, created_at, updated_at)
      VALUES (?, 'Garrett', 'idem', 'cancel', 'contact_1', 'appt_1', 'processing', 0, 1, 1, 1)`)
      .run("cmd_1");
    db.prepare(`INSERT INTO appointment_command_events
      (id, command_id, actor, phase, occurred_at) VALUES ('event_1', 'cmd_1', 'Garrett', 'claimed', 1)`).run();
    expect(() => db.exec("UPDATE appointment_command_events SET phase = 'changed' WHERE id = 'event_1'"))
      .toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM appointment_command_events WHERE id = 'event_1'"))
      .toThrow(/append-only/);
  });
});
