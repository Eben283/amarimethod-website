import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  CRM_PRODUCTION_V22_BOUNDARY,
  assessCrmSchemaRecovery,
  assessCrmSchemaSnapshot,
  captureLocalCrmSchemaSnapshot,
  classifyCrmSchemaInstallOutcome,
  createCrmSchemaInstallArtifact,
  crmSchemaReadbackQueries,
  deriveCrmSchemaCatalogDelta,
  planCrmSchemaInstall,
  verifyCrmSchemaTransition,
} from "../../scripts/crm-schema-install-plan.mjs";

const directory = new URL("../migrations/", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function migrationNames(through = 22) {
  return readdirSync(directory)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= through)
    .sort((left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4)));
}

function v22Database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE d1_migrations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );`);
  for (const name of migrationNames()) {
    db.exec(readFileSync(new URL(name, directory), "utf8"));
    db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
  }
  return db;
}

function seedPopulatedFixture(db) {
  db.prepare(`INSERT INTO contacts
    (id,first_name,last_name,display_name,email_normalized,phone_e164,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    "contact_fixture", "Local", "Fixture", "Local Fixture", "fixture@example.invalid", "+15555550123",
    "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z",
  );
  db.prepare(`INSERT INTO services
    (id,name,service_family,duration_minutes,package_eligible,provider_calendar_id,active,buffer_minutes,start_interval_minutes)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "fixture-service", "Fixture service", "fixture", 45, 0, "fixture-calendar", 1, 10, 15,
  );
  db.prepare(`INSERT INTO appointments
    (id,contact_id,service_id,provider_appointment_id,provider_calendar_id,provider_status_raw,status,
     starts_at,ends_at,timezone,authority,provider_sync_state,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "appointment_fixture", "contact_fixture", "fixture-service", "provider_fixture", "fixture-calendar",
    "showed", "attended", "2026-08-31T17:00:00.000Z", "2026-08-31T17:45:00.000Z", "America/Los_Angeles",
    "provider_mirror", "synced", 3, "2026-08-30T00:00:00.000Z", "2026-08-31T18:00:00.000Z",
  );
  db.prepare("INSERT INTO notes(id,contact_id,appointment_id,body,authored_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("note_fixture", "contact_fixture", "appointment_fixture", "existing note", "Garrett",
      "2026-08-31T18:00:00.000Z", "2026-08-31T18:00:00.000Z");
  db.prepare("INSERT INTO contact_tags(contact_id,tag,source,created_at) VALUES (?,?,?,?)")
    .run("contact_fixture", "provider-tag", "ghl", "2026-08-30T00:00:00.000Z");
  db.prepare("INSERT INTO contact_roles(contact_id,role,source,created_at) VALUES (?,?,?,?)")
    .run("contact_fixture", "client", "ghl", "2026-08-30T00:00:00.000Z");
}

describe("CRM schema-only v22 to v30 install plan", () => {
  it("pins exact migration bytes and emits only eight Wrangler-compatible ledger inserts", () => {
    const artifact = createCrmSchemaInstallArtifact();
    expect(artifact.migrationCount).toBe(8);
    expect(artifact.bytes).toBe(46181);
    expect(artifact.sha256).toBe("5be18c203f2fbf6051ad454d0fc84e0335f55a6261ef5b91e0eccc215135fb8e");
    expect(sha256(artifact.sql)).toBe(artifact.sha256);
    expect(artifact.sql.match(/INSERT INTO d1_migrations \(name\) VALUES \('[^']+'\);/g)).toHaveLength(8);
    expect(artifact.sql).not.toMatch(/\b(?:DROP|DELETE|UPDATE)\s+(?:DATABASE|d1_migrations)\b/i);
    expect(artifact.executionAuthorized).toBe(false);
    expect(artifact.productionWriteAuthorized).toBe(false);
  });

  it("derives and pins the exact additive catalog from executed migrations", () => {
    const delta = deriveCrmSchemaCatalogDelta();
    expect(delta.count).toBe(117);
    expect(delta.sha256).toBe("506daf9eb086b8462f5d4a8e37132244812d9b5495a4936150e90720d1e2214f");
    expect(delta.rows.filter((row) => row.type === "table")).toHaveLength(13);
    expect(delta.rows.some((row) => row.type === "view" && row.name === "owned_contact_classification_intake")).toBe(true);
  });

  it("installs cleanly from v22, verifies exact readback, and refuses replay through the ledger", () => {
    const db = v22Database();
    try {
      const before = captureLocalCrmSchemaSnapshot(db, { capturedAt: 1 });
      const artifact = createCrmSchemaInstallArtifact();
      db.exec(artifact.sql);
      const after = captureLocalCrmSchemaSnapshot(db, { capturedAt: 2 });
      const proof = verifyCrmSchemaTransition(before, after);
      expect(proof.status).toBe("verified");
      expect(proof.additiveCatalogCount).toBe(117);
      expect(proof.targetTableCounts.appointment_status_facts).toBe(0);
      expect(after.migrations.slice(-8).map((row) => row.name)).toEqual(artifact.migrations.map((row) => row.name));

      const targetDigest = sha256(JSON.stringify({ catalog: after.catalog, counts: after.tableCounts, ledger: after.migrations }));
      expect(() => db.exec(artifact.sql)).toThrow(/UNIQUE constraint failed: d1_migrations\.name/);
      const replayReadback = captureLocalCrmSchemaSnapshot(db, { capturedAt: 3 });
      expect(sha256(JSON.stringify({ catalog: replayReadback.catalog, counts: replayReadback.tableCounts, ledger: replayReadback.migrations })))
        .toBe(targetDigest);
    } finally {
      db.close();
    }
  });

  it("preserves populated v22 records and creates one honest baseline status fact per appointment", () => {
    const db = v22Database();
    try {
      seedPopulatedFixture(db);
      const before = captureLocalCrmSchemaSnapshot(db, { capturedAt: 10 });
      db.exec(createCrmSchemaInstallArtifact().sql);
      const after = captureLocalCrmSchemaSnapshot(db, { capturedAt: 11 });
      const proof = verifyCrmSchemaTransition(before, after);
      expect(proof.status).toBe("verified");
      expect(proof.targetTableCounts.appointment_status_facts).toBe(1);
      expect(db.prepare("SELECT * FROM appointment_status_facts").get()).toMatchObject({
        appointment_id: "appointment_fixture",
        contact_id: "contact_fixture",
        appointment_revision: 3,
        normalized_status: "attended",
        authority: "provider_mirror",
        source_kind: "migration_baseline",
        history_complete: 0,
      });
      expect(db.prepare("SELECT source FROM contact_tags WHERE contact_id=? AND tag=?").get("contact_fixture", "provider-tag").source).toBe("ghl");
      expect(db.prepare("SELECT source FROM contact_roles WHERE contact_id=? AND role=?").get("contact_fixture", "client").source).toBe("ghl");
      expect(db.prepare("SELECT body FROM notes WHERE id='note_fixture'").get().body).toBe("existing note");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("fails closed on partial installation, catalog drift, local evidence, and missing recovery", () => {
    const db = v22Database();
    try {
      const before = captureLocalCrmSchemaSnapshot(db, { capturedAt: 20 });
      const first = createCrmSchemaInstallArtifact().migrations[0].name;
      db.exec(readFileSync(new URL(first, directory), "utf8"));
      db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(first);
      const partial = captureLocalCrmSchemaSnapshot(db, { capturedAt: 21 });
      expect(verifyCrmSchemaTransition(before, partial)).toMatchObject({
        status: "refused",
        reasonCodes: ["partial_installation"],
      });
      expect(assessCrmSchemaSnapshot(before)).toMatchObject({ status: "refused", reasonCodes: ["wrong_database"] });
      expect(planCrmSchemaInstall({ sourceRevision: "a".repeat(40), snapshot: before, recovery: null })).toMatchObject({
        status: "refused",
        reasonCodes: ["wrong_database"],
      });
      expect(planCrmSchemaInstall({ sourceRevision: "a".repeat(40), snapshot: null, recovery: null })).toMatchObject({
        status: "pending",
        reasonCodes: ["missing_primary_snapshot"],
      });
      expect(classifyCrmSchemaInstallOutcome({ plan: { status: "planned", planSha256: "0".repeat(64) }, snapshot: null }))
        .toMatchObject({ status: "refused", classification: "indeterminate", reasonCodes: ["invalid_plan_identity"] });
    } finally {
      db.close();
    }
  });

  it("provides only read-only catalog, ledger, integrity, and bounded table-count queries", () => {
    const db = v22Database();
    try {
      const snapshot = captureLocalCrmSchemaSnapshot(db);
      const queries = crmSchemaReadbackQueries(snapshot.catalog);
      const all = [...Object.values(queries.fixed), ...queries.tableCounts.map((entry) => entry.sql)];
      expect(all.length).toBeGreaterThan(10);
      for (const sql of all) {
        expect(sql).toMatch(/^(?:SELECT|PRAGMA)\b/i);
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i);
      }
      expect(CRM_PRODUCTION_V22_BOUNDARY).toMatchObject({ catalogCount: 239, migrationCount: 24 });
    } finally {
      db.close();
    }
  });

  it("requires exact, fresh external recovery metadata without treating it as execution authority", () => {
    const now = Date.now();
    const recovery = {
      databaseId: "91a5a51d-0319-4c6d-9a6b-36bee3805e62",
      source: "cloudflare_time_travel",
      bookmark: "00001412-000000b4-000050d9-e397d7988c583be566d37d8cc54ed1db",
      capturedAt: now - 1_000,
      externalRecordId: "review-record-fixture",
      owner: "Eben",
    };
    expect(assessCrmSchemaRecovery(recovery, now)).toMatchObject({
      status: "proven",
      executionAuthorized: false,
      rollbackAuthorized: false,
    });
    expect(assessCrmSchemaRecovery({ ...recovery, bookmark: "not-a-bookmark" }, now)).toMatchObject({
      status: "refused",
      reasonCodes: ["invalid_recovery_metadata"],
    });
    expect(assessCrmSchemaRecovery({ ...recovery, capturedAt: now - 300_001 }, now)).toMatchObject({
      status: "refused",
      reasonCodes: ["recovery_metadata_not_fresh"],
    });
  });
});
