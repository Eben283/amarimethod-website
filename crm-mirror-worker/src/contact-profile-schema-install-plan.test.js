import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import {
  captureLocalCrmSchemaSnapshot,
  crmSchemaReadbackQueries,
} from "../../scripts/crm-schema-install-plan.mjs";
import {
  assessCrmContactProfileSchemaSnapshot,
  classifyCrmContactProfileSchemaOutcome,
  createCrmContactProfileSchemaImportTransport,
  createCrmContactProfileSchemaArtifact,
  crmContactProfileSchemaReadbackQueries,
  deriveCrmContactProfileCatalogTransform,
  planCrmContactProfileSchemaInstall,
  verifyCrmContactProfileSchemaTransition,
} from "../../scripts/crm-contact-profile-schema-install-plan.mjs";

const directory = new URL("../migrations/", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function names(through = 30) {
  return readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= through)
    .sort((left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4)) || left.localeCompare(right));
}

function v30Database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE d1_migrations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );`);
  for (const name of names()) {
    db.exec(readFileSync(new URL(name, directory), "utf8"));
    db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
  }
  return db;
}

function seedPopulated(db) {
  db.prepare(
    `INSERT INTO contacts
     (id,first_name,last_name,display_name,email_normalized,phone_e164,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    "contact-fixture", "Avery", "Existing", "Avery Existing", "avery@example.test", "+14155550123",
    "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO consents
     (id,contact_id,channel,state,effective_at,source,evidence_ref,recorded_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    "consent-fixture", "contact-fixture", "email", "granted", "2026-08-01T00:00:00.000Z",
    "ghl", "legacy-provider-observation", "crm_mirror",
  );
  db.prepare("INSERT INTO contact_tags(contact_id,tag,source,created_at) VALUES (?,?,?,?)")
    .run("contact-fixture", "provider-tag", "ghl", "2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO contact_roles(contact_id,role,source,created_at) VALUES (?,?,?,?)")
    .run("contact-fixture", "client", "ghl", "2026-08-01T00:00:00.000Z");
}

function snapshot(db, capturedAt) {
  return captureLocalCrmSchemaSnapshot(db, { capturedAt });
}

describe("CRM contact-profile schema-only v30 to v31 install plan", () => {
  it("pins the exact reviewed migration and emits one ledger insert without execution authority", () => {
    const artifact = createCrmContactProfileSchemaArtifact();
    expect(artifact).toMatchObject({
      fromMigration: "0030_owned_contact_classifications.sql",
      throughMigration: "0031_owned_contact_profile_authority.sql",
      migrationCount: 1,
      bytes: 13177,
      sha256: "b3b8017ffbf9472ed8423edd40cf2aabcf1b0efe2acb12a8a3cebdc228430248",
      executionAuthorized: false,
      productionWriteAuthorized: false,
      rollbackAuthorized: false,
    });
    expect(sha256(artifact.sql)).toBe(artifact.sha256);
    expect(artifact.migrations).toEqual([{
      name: "0031_owned_contact_profile_authority.sql",
      sha256: "b2d80fe9fb58528bf7adebbed6f1de45b3d3b7237a28725874f6cd3db8ab83f6",
      bytes: 13091,
    }]);
    expect(artifact.sql.match(/INSERT INTO d1_migrations \(name\) VALUES \('[^']+'\);/g)).toHaveLength(1);
    expect(artifact.sql).not.toMatch(/\b(?:DROP|DELETE|UPDATE)\s+(?:DATABASE|d1_migrations)\b/i);
  });

  it("pins the dedicated SQL-file import state machine without execution or retry authority", () => {
    const transport = createCrmContactProfileSchemaImportTransport();
    expect(transport).toMatchObject({
      kind: "d1_remote_sql_file_import_v1",
      endpoint: "import",
      parser: "provider_sql_file_ingestion",
      logicalImportOperations: 1,
      artifact: {
        bytes: 13177,
        sha256: "b3b8017ffbf9472ed8423edd40cf2aabcf1b0efe2acb12a8a3cebdc228430248",
        etagMd5: "751480a9353460a2f9025eca0f6153ca",
        expectedStatementCount: 23,
      },
      operationTimeoutMs: 300000,
      retryAllowed: false,
      uncertainPhasePolicy: "stop_without_reissuing_init_or_ingest_then_primary_readback",
      manifestBytes: 1533,
      sha256: "0a3662ef7cadfc8816f36f9432874961da7dffb1150e75df87fd4cfa4ff15125",
      executionAuthorized: false,
      productionWriteAuthorized: false,
    });
    expect(transport.protocol.init).toMatchObject({
      databaseMutation: "provider_state_dependent", mayBeginCachedIngestion: true, maximumRequests: 1,
    });
    expect(transport.protocol.upload).toMatchObject({ databaseMutation: false, maximumRequests: 1 });
    expect(transport.protocol.ingest).toMatchObject({
      condition: "only_after_verified_upload", databaseMutation: true, maximumRequests: 1,
    });
    expect(transport.protocol.poll).toMatchObject({
      databaseMutation: false, observesBackgroundMutation: true, maximumRequests: 60,
    });
    const { manifestBytes, sha256: manifestSha256, ...manifest } = transport;
    expect(Buffer.byteLength(canonicalJson(manifest))).toBe(manifestBytes);
    expect(sha256(canonicalJson(manifest))).toBe(manifestSha256);
  });

  it("pins two altered core definitions and all sixteen additive objects from SQLite execution", () => {
    const transform = deriveCrmContactProfileCatalogTransform();
    expect(transform).toMatchObject({
      localBeforeCount: 346,
      localBeforeSha256: "1a28e19e638635197dd52c719e9fd80e1b4f640a0228fcf0abac5906dcdde897",
      localAfterCount: 362,
      localAfterSha256: "9ea11daa93e106afdcbda00855c8b3529c3debfca43d39c65f7de1f78713f387",
      addedCount: 16,
      addedSha256: "8089c9f7705ee92709cad0bfce7fdea77022127dfc88d61f4cd99a84c8ff97d7",
      changedCount: 2,
      changedBeforeSha256: "d6c3ecc341a92c00172da576f650e4d34f5da60ce19bce19891c19dd90cac81d",
      changedAfterSha256: "983467ffadf7092cf83abd6768165a02225bdbf7d3fefc0fcc8964121650af20",
    });
    expect(transform.changedBefore.map((row) => row.name)).toEqual(["consents", "contacts"]);
    expect(transform.added.some((row) => row.type === "table" && row.name === "owned_contact_profile_commands")).toBe(true);
    expect(transform.added.filter((row) => row.type === "trigger")).toHaveLength(11);
  });

  it("preserves populated v30 truth and proves the exact non-additive transition", () => {
    const db = v30Database();
    try {
      seedPopulated(db);
      const before = snapshot(db, 1);
      const beforeContact = db.prepare("SELECT * FROM contacts WHERE id='contact-fixture'").get();
      const beforeConsent = db.prepare("SELECT * FROM consents WHERE id='consent-fixture'").get();
      db.exec(createCrmContactProfileSchemaArtifact().sql);
      const after = snapshot(db, 2);
      const proof = verifyCrmContactProfileSchemaTransition(before, after);
      expect(proof).toMatchObject({
        status: "verified",
        classification: "exact_schema_only_v30_to_v31_transition",
        beforeCatalogCount: 346,
        afterCatalogCount: 362,
        addedCatalogCount: 16,
        changedCatalogCount: 2,
      });
      expect(db.prepare(
        `SELECT id,first_name,last_name,display_name,email_normalized,phone_e164,
                created_at,updated_at,archived_at,referral_source_label
           FROM contacts WHERE id='contact-fixture'`,
      ).get()).toMatchObject(beforeContact);
      expect(db.prepare(
        `SELECT name_authority,name_revision,email_authority,email_revision,phone_authority,phone_revision
           FROM contacts WHERE id='contact-fixture'`,
      ).get()).toEqual({
        name_authority: "provider_mirror", name_revision: 0,
        email_authority: "provider_mirror", email_revision: 0,
        phone_authority: "provider_mirror", phone_revision: 0,
      });
      expect(db.prepare(
        `SELECT id,contact_id,channel,state,effective_at,source,evidence_ref,recorded_by
           FROM consents WHERE id='consent-fixture'`,
      ).get()).toMatchObject(beforeConsent);
      expect(db.prepare(
        "SELECT destination_normalized,destination_sha256 FROM consents WHERE id='consent-fixture'",
      ).get()).toEqual({ destination_normalized: null, destination_sha256: null });
      expect(after.tableCounts.owned_contact_profile_commands).toBe(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const installedDigest = sha256(JSON.stringify({
        catalog: after.catalog, migrations: after.migrations, tableCounts: after.tableCounts,
      }));
      expect(() => db.exec(createCrmContactProfileSchemaArtifact().sql)).toThrow(/duplicate column name/i);
      const replay = snapshot(db, 3);
      expect(sha256(JSON.stringify({
        catalog: replay.catalog, migrations: replay.migrations, tableCounts: replay.tableCounts,
      }))).toBe(installedDigest);
    } finally {
      db.close();
    }
  });

  it("fails closed on catalog, ledger, count, integrity, and production-evidence drift", () => {
    const db = v30Database();
    try {
      seedPopulated(db);
      const before = snapshot(db, 10);
      db.exec(createCrmContactProfileSchemaArtifact().sql);
      const after = snapshot(db, 11);
      const changedCatalog = after.catalog.map((row) => row.name === "contacts" ? { ...row, sql: `${row.sql} ` } : row);
      expect(verifyCrmContactProfileSchemaTransition(before, { ...after, catalog: changedCatalog }))
        .toMatchObject({ status: "refused", reasonCodes: ["catalog_transition_mismatch"] });
      expect(verifyCrmContactProfileSchemaTransition(before, {
        ...after,
        migrations: after.migrations.map((row, index) => index === after.migrations.length - 1
          ? { ...row, name: "forged.sql" } : row),
      })).toMatchObject({ status: "refused", reasonCodes: ["migration_ledger_transition_mismatch"] });
      expect(verifyCrmContactProfileSchemaTransition(before, {
        ...after, tableCounts: { ...after.tableCounts, contacts: after.tableCounts.contacts + 1 },
      })).toMatchObject({ status: "refused", reasonCodes: ["table_count_mismatch"] });
      expect(verifyCrmContactProfileSchemaTransition(before, {
        ...after, foreignKeyViolations: [{ table: "forged" }],
      })).toMatchObject({ status: "refused", reasonCodes: ["after_foreign_key_violation"] });
      expect(assessCrmContactProfileSchemaSnapshot(after)).toMatchObject({
        status: "refused", reasonCodes: ["wrong_database"],
      });
    } finally {
      db.close();
    }
  });

  it("keeps planning pending/refused without fresh exact primary evidence and fresh recovery metadata", () => {
    expect(planCrmContactProfileSchemaInstall({
      sourceRevision: "a".repeat(40), snapshot: null, recovery: null,
    })).toMatchObject({ status: "pending", reasonCodes: ["missing_primary_snapshot"] });
    expect(planCrmContactProfileSchemaInstall({
      sourceRevision: "not-a-revision", snapshot: null, recovery: null,
    })).toMatchObject({ status: "refused", reasonCodes: ["invalid_source_revision"] });
    expect(classifyCrmContactProfileSchemaOutcome({
      plan: { status: "planned", contract: "forged", planSha256: "0".repeat(64) }, snapshot: null,
    })).toMatchObject({ status: "refused", classification: "indeterminate", reasonCodes: ["invalid_plan_identity"] });
  });

  it("exposes only read-only catalog, ledger, integrity, and bounded count queries", () => {
    expect(crmContactProfileSchemaReadbackQueries).toBe(crmSchemaReadbackQueries);
    const db = v30Database();
    try {
      const queries = crmContactProfileSchemaReadbackQueries(snapshot(db, 20).catalog);
      const all = [...Object.values(queries.fixed), ...queries.tableCounts.map((entry) => entry.sql)];
      expect(all.length).toBeGreaterThan(10);
      for (const sql of all) {
        expect(sql).toMatch(/^(?:SELECT|PRAGMA)\b/i);
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i);
      }
    } finally {
      db.close();
    }
  });
});
