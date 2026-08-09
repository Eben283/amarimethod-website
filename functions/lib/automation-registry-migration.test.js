import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../automation-db/migrations/0001_registry_versioning.sql", import.meta.url),
  "utf8",
);

describe("automation registry versioning migration", () => {
  it("keeps pre-registry enrollment versions unknown while new writes may record an exact version", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE reminder_enrollments (
        enrollment_id TEXT PRIMARY KEY,
        flow_key TEXT NOT NULL,
        appointment_id TEXT NOT NULL,
        contact_id TEXT NOT NULL
      );
      CREATE TABLE nurture_enrollments (
        enrollment_id TEXT PRIMARY KEY,
        sequence_id TEXT NOT NULL,
        contact_id TEXT NOT NULL
      );
      CREATE TABLE automation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        engine TEXT,
        flow_key TEXT,
        contact_id TEXT
      );
      INSERT INTO reminder_enrollments VALUES ('legacy-reminder', 'initial-in-person', 'appointment-1', 'contact-1');
      INSERT INTO nurture_enrollments VALUES ('legacy-nurture', 'flow-1-quiz', 'contact-1');
    `);

    db.exec(migration);

    expect(db.prepare("SELECT definition_version FROM reminder_enrollments WHERE enrollment_id = ?").get("legacy-reminder"))
      .toEqual({ definition_version: null });
    expect(db.prepare("SELECT definition_version FROM nurture_enrollments WHERE enrollment_id = ?").get("legacy-nurture"))
      .toEqual({ definition_version: null });

    db.prepare(
      "INSERT INTO reminder_enrollments (enrollment_id, flow_key, definition_version, appointment_id, contact_id) VALUES (?, ?, ?, ?, ?)",
    ).run("owned-reminder", "initial-in-person", 1, "appointment-2", "contact-2");
    expect(db.prepare("SELECT definition_version FROM reminder_enrollments WHERE enrollment_id = ?").get("owned-reminder"))
      .toEqual({ definition_version: 1 });
    db.close();
  });
});
