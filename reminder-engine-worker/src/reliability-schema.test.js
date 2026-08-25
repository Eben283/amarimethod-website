import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const reliabilityStart = schema.indexOf("CREATE TABLE IF NOT EXISTS reliability_schema_versions");
const reliabilitySchema = schema.slice(reliabilityStart);
const expected = [
  "reliability_schema_versions", "source_events", "source_event_transitions", "lifecycle_instances", "lifecycle_obligations",
  "obligation_lease_events", "command_attempts", "provider_receipts", "reconciliation_runs", "lifecycle_exceptions",
  "exception_events", "evidence_access_events",
];

function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
}

describe("forward-only reliability schema", () => {
  it("applies to an empty database and is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(schema);
    db.exec(schema);
    for (const table of expected) expect(tables(db)).toContain(table);
    expect(db.prepare("SELECT version, migration_id FROM reliability_schema_versions").get())
      .toEqual({ version: 1, migration_id: "reliability-spine-v1" });
  });

  it("preserves populated legacy evidence while adding the spine", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE reminder_enrollments (enrollment_id TEXT PRIMARY KEY, contact_id TEXT);
      INSERT INTO reminder_enrollments VALUES ('legacy-1','person-1');`);
    db.exec(reliabilitySchema);
    expect(db.prepare("SELECT * FROM reminder_enrollments").get()).toEqual({ enrollment_id: "legacy-1", contact_id: "person-1" });
    for (const table of expected) expect(tables(db)).toContain(table);
  });

  it("makes the approved 400-day normalized/audit retention explicit on every evidence table", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(schema);
    for (const table of [
      "source_events", "lifecycle_instances", "lifecycle_obligations", "command_attempts",
      "source_event_transitions", "obligation_lease_events", "provider_receipts", "reconciliation_runs",
      "lifecycle_exceptions", "exception_events", "evidence_access_events",
    ]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
      expect(columns, table).toContain(table === "source_events" ? "normalized_retention_until" : "retention_until");
    }
  });

  it("rolls an interrupted reliability migration back and succeeds on forward retry", () => {
    const db = new DatabaseSync(":memory:");
    const broken = reliabilitySchema.replace(
      "CREATE TABLE IF NOT EXISTS lifecycle_instances",
      "THIS IS AN INTENTIONAL MIGRATION FAILURE;\nCREATE TABLE IF NOT EXISTS lifecycle_instances",
    );
    db.exec("BEGIN");
    expect(() => db.exec(broken)).toThrow();
    db.exec("ROLLBACK");
    expect(tables(db).filter((name) => expected.includes(name))).toEqual([]);
    db.exec(reliabilitySchema);
    for (const table of expected) expect(tables(db)).toContain(table);
  });
});
