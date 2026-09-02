// OFFLINE ONLY. This module turns reviewed migration 0031 into one exact SQL artifact and
// reasons over caller-supplied/read-only snapshots. It has no Cloudflare client, credential
// access, provider adapter, deployment path, database write path, rollback path, or authority
// promotion seam.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../functions/lib/automation-truth-phase-b.js";
import {
  CRM_DATABASE,
  assessCrmSchemaRecovery,
  assessCrmSchemaSnapshot,
  crmSchemaReadbackQueries,
  splitCrmSchemaSqlStatements,
} from "./crm-schema-install-plan.mjs";

export const CRM_CONTACT_PROFILE_SCHEMA_CONTRACT = "crm-contact-profile-schema-install-plan.v2";
export const CRM_V30_BOUNDARY = Object.freeze({
  migrationCount: 32,
  lastMigration: "0030_owned_contact_classifications.sql",
});

const MIGRATIONS_DIRECTORY = new URL("../crm-mirror-worker/migrations/", import.meta.url);
const MIGRATION_NAME = "0031_owned_contact_profile_authority.sql";
const MIGRATION_SHA256 = "b2d80fe9fb58528bf7adebbed6f1de45b3d3b7237a28725874f6cd3db8ab83f6";
const EXPECTED_ARTIFACT = Object.freeze({
  bytes: 13177,
  sha256: "b3b8017ffbf9472ed8423edd40cf2aabcf1b0efe2acb12a8a3cebdc228430248",
});
const EXPECTED_IMPORT_TRANSPORT = Object.freeze({
  artifactMd5: "751480a9353460a2f9025eca0f6153ca",
  statementCount: 23,
  manifestBytes: 1533,
  sha256: "0a3662ef7cadfc8816f36f9432874961da7dffb1150e75df87fd4cfa4ff15125",
});
const EXPECTED_TRANSFORM = Object.freeze({
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
const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
const LOCAL_V30_MIGRATION_COUNT = 30;
const RESULT_FLAGS = Object.freeze({
  sourceOnly: true,
  executionAuthorized: false,
  productionWriteAuthorized: false,
  deploymentAuthorized: false,
  providerChangeAuthorized: false,
  customerActionAuthorized: false,
  authorityPromotionAuthorized: false,
  rollbackAuthorized: false,
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const md5 = (value) => createHash("md5").update(value).digest("hex");
const catalogKey = (row) => `${row.type}:${row.name}`;
const sortedCatalog = (rows) => [...rows].sort((left, right) =>
  left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
const digestRows = (rows) => sha256(canonicalJson(sortedCatalog(rows)));
const digestLedger = (rows) => sha256(canonicalJson(rows));
const result = (status, extra = {}) => Object.freeze({
  contract: CRM_CONTACT_PROFILE_SCHEMA_CONTRACT,
  ...RESULT_FLAGS,
  status,
  ...extra,
});

function exactObject(value, keys, code = "invalid_input") {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000") !== [...keys].sort().join("\u0000")) throw new Error(code);
}

function validRevision(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function migrationNames(through = 30) {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, 4)) <= through)
    .sort((left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4)) || left.localeCompare(right));
}

function migrationSql() {
  const sql = readFileSync(new URL(MIGRATION_NAME, MIGRATIONS_DIRECTORY), "utf8");
  if (sha256(sql) !== MIGRATION_SHA256) throw new Error("migration_hash_mismatch");
  return sql;
}

function ledgerInsert() {
  return `INSERT INTO d1_migrations (name) VALUES ('${MIGRATION_NAME}');\n`;
}

/** Exact reviewed migration bytes plus exactly one Wrangler-compatible migration-ledger insert. */
export function createCrmContactProfileSchemaArtifact() {
  const migration = migrationSql();
  const sql = migration + (migration.endsWith("\n") ? "" : "\n") + ledgerInsert();
  const bytes = Buffer.byteLength(sql);
  const artifactSha256 = sha256(sql);
  if (bytes !== EXPECTED_ARTIFACT.bytes || artifactSha256 !== EXPECTED_ARTIFACT.sha256) {
    throw new Error("install_artifact_mismatch");
  }
  return Object.freeze({
    contract: CRM_CONTACT_PROFILE_SCHEMA_CONTRACT,
    database: CRM_DATABASE,
    fromMigration: CRM_V30_BOUNDARY.lastMigration,
    throughMigration: MIGRATION_NAME,
    migrationCount: 1,
    migrations: Object.freeze([Object.freeze({
      name: MIGRATION_NAME,
      sha256: MIGRATION_SHA256,
      bytes: Buffer.byteLength(migration),
    })]),
    sql,
    bytes,
    sha256: artifactSha256,
    statementScope: "exact_0031_migration_bytes_plus_one_d1_migrations_insert",
    ...RESULT_FLAGS,
  });
}

/** Exact source-only D1 SQL-file import contract for the reviewed 0031 artifact. */
export function createCrmContactProfileSchemaImportTransport() {
  const artifact = createCrmContactProfileSchemaArtifact();
  const artifactMd5 = md5(artifact.sql);
  const statementCount = splitCrmSchemaSqlStatements(artifact.sql).length;
  if (artifactMd5 !== EXPECTED_IMPORT_TRANSPORT.artifactMd5
    || statementCount !== EXPECTED_IMPORT_TRANSPORT.statementCount) {
    throw new Error("install_import_transport_mismatch");
  }
  const manifest = Object.freeze({
    kind: "d1_remote_sql_file_import_v1",
    endpoint: "import",
    parser: "provider_sql_file_ingestion",
    logicalImportOperations: 1,
    artifact: Object.freeze({
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      etagMd5: artifactMd5,
      expectedStatementCount: statementCount,
    }),
    protocol: Object.freeze({
      init: Object.freeze({
        method: "POST",
        body: Object.freeze({ action: "init", etag: artifactMd5 }),
        databaseMutation: "provider_state_dependent",
        mayBeginCachedIngestion: true,
        maximumRequests: 1,
      }),
      upload: Object.freeze({
        method: "PUT",
        urlSource: "provider_init_upload_url",
        filenameSource: "provider_init_filename",
        body: "exact_artifact_bytes",
        requireResponseEtagMd5: artifactMd5,
        databaseMutation: false,
        maximumRequests: 1,
      }),
      ingest: Object.freeze({
        method: "POST",
        bodyTemplate: Object.freeze({ action: "ingest", filename: "provider_init_filename", etag: artifactMd5 }),
        condition: "only_after_verified_upload",
        databaseMutation: true,
        maximumRequests: 1,
      }),
      poll: Object.freeze({
        method: "POST",
        bodyTemplate: Object.freeze({ action: "poll", current_bookmark: "provider_previous_at_bookmark" }),
        databaseMutation: false,
        observesBackgroundMutation: true,
        maximumRequests: 60,
      }),
    }),
    operationTimeoutMs: 300000,
    retryAllowed: false,
    uncertainPhasePolicy: "stop_without_reissuing_init_or_ingest_then_primary_readback",
    ...RESULT_FLAGS,
  });
  const json = canonicalJson(manifest);
  const manifestBytes = Buffer.byteLength(json);
  const manifestSha256 = sha256(json);
  if (manifestBytes !== EXPECTED_IMPORT_TRANSPORT.manifestBytes
    || manifestSha256 !== EXPECTED_IMPORT_TRANSPORT.sha256) {
    throw new Error("install_import_manifest_mismatch");
  }
  return Object.freeze({
    ...manifest,
    manifestBytes,
    sha256: manifestSha256,
  });
}

function createLedger(db) {
  db.exec(`CREATE TABLE d1_migrations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
}

function schemaRows(db) {
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE type IN ('table','index','trigger','view') ORDER BY type,name`).all();
}

function makeV30Schema() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  createLedger(db);
  const names = migrationNames();
  if (names.length !== LOCAL_V30_MIGRATION_COUNT) {
    db.close();
    throw new Error("v30_migration_set_mismatch");
  }
  for (const name of names) db.exec(readFileSync(new URL(name, MIGRATIONS_DIRECTORY), "utf8"));
  return db;
}

/** Derives both ALTER-mutated core rows and added objects from real SQLite execution. */
export function deriveCrmContactProfileCatalogTransform() {
  const db = makeV30Schema();
  try {
    const before = schemaRows(db);
    db.exec(migrationSql());
    const after = schemaRows(db);
    const beforeByKey = new Map(before.map((row) => [catalogKey(row), row]));
    const afterByKey = new Map(after.map((row) => [catalogKey(row), row]));
    const added = sortedCatalog(after.filter((row) => !beforeByKey.has(catalogKey(row))));
    const removed = before.filter((row) => !afterByKey.has(catalogKey(row)));
    const changedBefore = sortedCatalog(before.filter((row) => afterByKey.has(catalogKey(row))
      && canonicalJson(row) !== canonicalJson(afterByKey.get(catalogKey(row)))));
    const changedAfter = sortedCatalog(changedBefore.map((row) => afterByKey.get(catalogKey(row))));
    if (removed.length) throw new Error("catalog_removal_detected");
    const actual = {
      localBeforeCount: before.length,
      localBeforeSha256: digestRows(before),
      localAfterCount: after.length,
      localAfterSha256: digestRows(after),
      addedCount: added.length,
      addedSha256: digestRows(added),
      changedCount: changedBefore.length,
      changedBeforeSha256: digestRows(changedBefore),
      changedAfterSha256: digestRows(changedAfter),
    };
    if (canonicalJson(actual) !== canonicalJson(EXPECTED_TRANSFORM)) throw new Error("catalog_transform_mismatch");
    return Object.freeze({
      added: Object.freeze(added.map((row) => Object.freeze({ ...row }))),
      changedBefore: Object.freeze(changedBefore.map((row) => Object.freeze({ ...row }))),
      changedAfter: Object.freeze(changedAfter.map((row) => Object.freeze({ ...row }))),
      ...actual,
    });
  } finally {
    db.close();
  }
}

function transformCatalog(catalog, transform) {
  const rows = new Map(catalog.map((row) => [catalogKey(row), row]));
  for (const row of transform.added) {
    if (rows.has(catalogKey(row))) throw new Error("target_object_present_before");
  }
  for (let index = 0; index < transform.changedBefore.length; index += 1) {
    const before = transform.changedBefore[index];
    const current = rows.get(catalogKey(before));
    if (!current || canonicalJson(current) !== canonicalJson(before)) throw new Error("core_catalog_drift_before");
    rows.set(catalogKey(before), transform.changedAfter[index]);
  }
  for (const row of transform.added) rows.set(catalogKey(row), row);
  return sortedCatalog([...rows.values()]);
}

function reverseCatalog(catalog, transform) {
  const rows = new Map(catalog.map((row) => [catalogKey(row), row]));
  for (const added of transform.added) {
    const current = rows.get(catalogKey(added));
    if (!current || canonicalJson(current) !== canonicalJson(added)) throw new Error("target_catalog_missing_or_conflicting");
    rows.delete(catalogKey(added));
  }
  for (let index = 0; index < transform.changedAfter.length; index += 1) {
    const after = transform.changedAfter[index];
    const current = rows.get(catalogKey(after));
    if (!current || canonicalJson(current) !== canonicalJson(after)) throw new Error("core_catalog_drift_after");
    rows.set(catalogKey(after), transform.changedBefore[index]);
  }
  return sortedCatalog([...rows.values()]);
}

function userTableNames(catalog) {
  return catalog.filter((row) => row.type === "table"
    && row.name !== "d1_migrations"
    && !row.name.startsWith("sqlite_")
    && !row.name.startsWith("_cf_"))
    .map((row) => row.name).sort();
}

function validateSnapshot(snapshot) {
  exactObject(snapshot, ["databaseId", "databaseName", "environment", "evidenceScope", "capturedAt",
    "servedByPrimary", "readReplicationEnabled", "catalog", "migrations", "tableCounts",
    "foreignKeysEnabled", "foreignKeyViolations", "quickCheck"], "invalid_snapshot");
  if (!Number.isSafeInteger(snapshot.capturedAt) || snapshot.capturedAt < 1
    || !Array.isArray(snapshot.catalog) || !snapshot.catalog.length
    || !Array.isArray(snapshot.migrations) || !snapshot.migrations.length
    || !snapshot.tableCounts || typeof snapshot.tableCounts !== "object" || Array.isArray(snapshot.tableCounts)
    || !Array.isArray(snapshot.foreignKeyViolations) || !Array.isArray(snapshot.quickCheck)) {
    throw new Error("invalid_snapshot");
  }
  const keys = new Set();
  for (const row of snapshot.catalog) {
    exactObject(row, ["type", "name", "tbl_name", "sql"], "invalid_catalog");
    const key = catalogKey(row);
    if (!new Set(["table", "index", "trigger", "view"]).has(row.type) || keys.has(key)) throw new Error("invalid_catalog");
    keys.add(key);
  }
  let previousId = 0;
  for (const row of snapshot.migrations) {
    exactObject(row, ["id", "name", "applied_at"], "invalid_migration_ledger");
    if (!Number.isSafeInteger(row.id) || row.id <= previousId || typeof row.name !== "string" || !row.name) {
      throw new Error("invalid_migration_ledger");
    }
    previousId = row.id;
  }
  const expectedTables = userTableNames(snapshot.catalog);
  if (Object.keys(snapshot.tableCounts).sort().join("\u0000") !== expectedTables.join("\u0000")) {
    throw new Error("invalid_table_counts");
  }
  for (const count of Object.values(snapshot.tableCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid_table_counts");
  }
}

function integrityReason(snapshot) {
  if (!snapshot.foreignKeysEnabled) return "foreign_keys_disabled";
  if (snapshot.foreignKeyViolations.length) return "foreign_key_violation";
  const quick = snapshot.quickCheck.map((row) => typeof row === "string" ? row : String(Object.values(row || {})[0]));
  if (quick.length !== 1 || quick[0] !== "ok") {
    return "quick_check_failed";
  }
  return null;
}

function exactProductionV31Ledger(rows) {
  return rows.length === CRM_V30_BOUNDARY.migrationCount + 1
    && rows.at(-2)?.name === CRM_V30_BOUNDARY.lastMigration
    && rows.at(-1)?.name === MIGRATION_NAME
    && rows.at(-1)?.id === rows.at(-2)?.id + 1;
}

function v30SnapshotFromV31(snapshot, transform) {
  if (!exactProductionV31Ledger(snapshot.migrations)) throw new Error("target_ledger_mismatch");
  if (snapshot.tableCounts.owned_contact_profile_commands !== 0) throw new Error("target_table_not_empty");
  const tableCounts = { ...snapshot.tableCounts };
  delete tableCounts.owned_contact_profile_commands;
  return {
    ...snapshot,
    catalog: reverseCatalog(snapshot.catalog, transform),
    migrations: snapshot.migrations.slice(0, -1),
    tableCounts,
  };
}

/** Production classifier: exact existing v30 or exact 0031 catalog/ledger over that v30 base. */
export function assessCrmContactProfileSchemaSnapshot(snapshot) {
  try {
    validateSnapshot(snapshot);
    if (snapshot.databaseId !== CRM_DATABASE.id || snapshot.databaseName !== CRM_DATABASE.name
      || snapshot.environment !== "production") throw new Error("wrong_database");
    const integrity = integrityReason(snapshot);
    if (integrity) throw new Error(integrity);
    if (!snapshot.servedByPrimary || snapshot.readReplicationEnabled !== false
      || snapshot.evidenceScope !== "production_d1_primary_readback") throw new Error("primary_readback_unproven");
    const current = assessCrmSchemaSnapshot(snapshot);
    if (current.status === "proven" && current.classification === "exact_v30_catalog_and_ledger") {
      return result("proven", {
        classification: "exact_v30_base",
        catalogCount: snapshot.catalog.length,
        catalogSha256: digestRows(snapshot.catalog),
        migrationCount: snapshot.migrations.length,
        migrationLedgerSha256: digestLedger(snapshot.migrations),
      });
    }
    const transform = deriveCrmContactProfileCatalogTransform();
    const reconstructed = v30SnapshotFromV31(snapshot, transform);
    const base = assessCrmSchemaSnapshot(reconstructed);
    if (base.status !== "proven" || base.classification !== "exact_v30_catalog_and_ledger") {
      throw new Error("v30_base_not_proven");
    }
    return result("proven", {
      classification: "exact_v31_catalog_and_ledger",
      catalogCount: snapshot.catalog.length,
      catalogSha256: digestRows(snapshot.catalog),
      migrationCount: snapshot.migrations.length,
      migrationLedgerSha256: digestLedger(snapshot.migrations),
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "snapshot_assessment_failed"] });
  }
}

function expectedAfterCounts(before) {
  return Object.fromEntries(Object.entries({
    ...before.tableCounts,
    owned_contact_profile_commands: 0,
  }).sort(([left], [right]) => left.localeCompare(right)));
}

/** Exact before/after preservation proof usable with local fixtures or captured primary snapshots. */
export function verifyCrmContactProfileSchemaTransition(before, after) {
  try {
    validateSnapshot(before);
    validateSnapshot(after);
    if (before.databaseId !== after.databaseId || before.databaseName !== after.databaseName
      || before.environment !== after.environment || after.capturedAt < before.capturedAt) {
      throw new Error("snapshot_identity_mismatch");
    }
    const beforeIntegrity = integrityReason(before);
    const afterIntegrity = integrityReason(after);
    if (beforeIntegrity) throw new Error(`before_${beforeIntegrity}`);
    if (afterIntegrity) throw new Error(`after_${afterIntegrity}`);
    if (before.migrations.at(-1)?.name !== CRM_V30_BOUNDARY.lastMigration
      || before.migrations.some((row) => row.name === MIGRATION_NAME)) throw new Error("v30_ledger_required");
    const transform = deriveCrmContactProfileCatalogTransform();
    const expectedCatalog = transformCatalog(before.catalog, transform);
    if (canonicalJson(after.catalog) !== canonicalJson(expectedCatalog)) throw new Error("catalog_transition_mismatch");
    if (after.migrations.length !== before.migrations.length + 1
      || after.migrations.at(-1)?.name !== MIGRATION_NAME
      || after.migrations.at(-1)?.id !== before.migrations.at(-1)?.id + 1
      || canonicalJson(after.migrations.slice(0, -1)) !== canonicalJson(before.migrations)) {
      throw new Error("migration_ledger_transition_mismatch");
    }
    if (canonicalJson(after.tableCounts) !== canonicalJson(expectedAfterCounts(before))) {
      throw new Error("table_count_mismatch");
    }
    return result("verified", {
      classification: "exact_schema_only_v30_to_v31_transition",
      beforeCatalogCount: before.catalog.length,
      beforeCatalogSha256: digestRows(before.catalog),
      afterCatalogCount: after.catalog.length,
      afterCatalogSha256: digestRows(after.catalog),
      addedCatalogCount: transform.addedCount,
      addedCatalogSha256: transform.addedSha256,
      changedCatalogCount: transform.changedCount,
      changedCatalogBeforeSha256: transform.changedBeforeSha256,
      changedCatalogAfterSha256: transform.changedAfterSha256,
      beforeMigrationLedgerSha256: digestLedger(before.migrations),
      afterMigrationLedgerSha256: digestLedger(after.migrations),
      preservedTableCountsSha256: sha256(canonicalJson(before.tableCounts)),
      reasonCodes: ["readback_only_no_authority_promotion"],
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "transition_verification_failed"] });
  }
}

function planBody(plan) {
  return {
    contract: plan.contract,
    database: plan.database,
    sourceRevision: plan.sourceRevision,
    basisCapturedAt: plan.basisCapturedAt,
    basisCatalogCount: plan.basisCatalogCount,
    basisCatalogSha256: plan.basisCatalogSha256,
    basisMigrationLedgerSha256: plan.basisMigrationLedgerSha256,
    basisTableCounts: plan.basisTableCounts,
    recovery: plan.recovery,
    artifact: plan.artifact,
    transport: plan.transport,
    expectedAfterCatalogCount: plan.expectedAfterCatalogCount,
    expectedAfterCatalogSha256: plan.expectedAfterCatalogSha256,
    expectedAfterMigrationCount: plan.expectedAfterMigrationCount,
    expectedAfterTableCounts: plan.expectedAfterTableCounts,
  };
}

/** Fresh caller evidence can produce a deterministic plan, never execution authority. */
export function planCrmContactProfileSchemaInstall(options, now = Date.now()) {
  try {
    exactObject(options, ["sourceRevision", "snapshot", "recovery"]);
    if (!validRevision(options.sourceRevision)) throw new Error("invalid_source_revision");
    if (options.snapshot === null) return result("pending", { reasonCodes: ["missing_primary_snapshot"] });
    const assessment = assessCrmContactProfileSchemaSnapshot(options.snapshot);
    if (assessment.status !== "proven") return result("refused", { reasonCodes: assessment.reasonCodes });
    if (assessment.classification === "exact_v31_catalog_and_ledger") {
      return result("already_installed", { reasonCodes: ["readback_only_no_replay"] });
    }
    if (options.snapshot.capturedAt > now || now - options.snapshot.capturedAt > MAX_SNAPSHOT_AGE_MS) {
      return result("pending", { reasonCodes: ["snapshot_not_fresh"] });
    }
    if (options.recovery === null) return result("pending", { reasonCodes: ["missing_recovery_metadata"] });
    const recovery = assessCrmSchemaRecovery(options.recovery, now);
    if (recovery.status !== "proven") return result("refused", { reasonCodes: recovery.reasonCodes });
    const artifact = createCrmContactProfileSchemaArtifact();
    const transport = createCrmContactProfileSchemaImportTransport();
    const afterCatalog = transformCatalog(options.snapshot.catalog, deriveCrmContactProfileCatalogTransform());
    const body = {
      contract: CRM_CONTACT_PROFILE_SCHEMA_CONTRACT,
      database: CRM_DATABASE,
      sourceRevision: options.sourceRevision,
      basisCapturedAt: options.snapshot.capturedAt,
      basisCatalogCount: options.snapshot.catalog.length,
      basisCatalogSha256: digestRows(options.snapshot.catalog),
      basisMigrationLedgerSha256: digestLedger(options.snapshot.migrations),
      basisTableCounts: options.snapshot.tableCounts,
      recovery: options.recovery,
      artifact: { sha256: artifact.sha256, bytes: artifact.bytes, migrations: artifact.migrations },
      transport: {
        kind: transport.kind,
        endpoint: transport.endpoint,
        artifactMd5: transport.artifact.etagMd5,
        statementCount: transport.artifact.expectedStatementCount,
        manifestBytes: transport.manifestBytes,
        sha256: transport.sha256,
      },
      expectedAfterCatalogCount: afterCatalog.length,
      expectedAfterCatalogSha256: digestRows(afterCatalog),
      expectedAfterMigrationCount: options.snapshot.migrations.length + 1,
      expectedAfterTableCounts: expectedAfterCounts(options.snapshot),
    };
    return result("planned", {
      ...body,
      planSha256: sha256(canonicalJson(body)),
      evidenceScope: "caller_supplied_metadata_not_authenticated",
      reasonCodes: [
        "separate_exact_execution_approval_required",
        "fresh_primary_revalidation_required_at_execution",
        "recovery_bookmark_not_authenticated_by_offline_plan",
        "single_logical_file_import_requires_execution_readback",
        "immediate_read_only_primary_readback_required",
      ],
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "install_plan_unavailable"] });
  }
}

/** Lost responses are classified from readback and are never converted into replay authority. */
export function classifyCrmContactProfileSchemaOutcome(options, now = Date.now()) {
  try {
    exactObject(options, ["plan", "snapshot"]);
    const { plan, snapshot } = options;
    if (!plan || plan.status !== "planned" || plan.contract !== CRM_CONTACT_PROFILE_SCHEMA_CONTRACT
      || plan.planSha256 !== sha256(canonicalJson(planBody(plan)))) throw new Error("invalid_plan_identity");
    if (snapshot === null) return result("pending", {
      classification: "indeterminate",
      reasonCodes: ["missing_primary_snapshot"],
    });
    const assessment = assessCrmContactProfileSchemaSnapshot(snapshot);
    if (assessment.status !== "proven") return result("refused", {
      classification: "indeterminate",
      reasonCodes: assessment.reasonCodes,
    });
    if (snapshot.capturedAt > now || now - snapshot.capturedAt > MAX_SNAPSHOT_AGE_MS) return result("pending", {
      classification: "indeterminate",
      reasonCodes: ["snapshot_not_fresh"],
    });
    if (snapshot.capturedAt < Math.max(plan.basisCapturedAt, plan.recovery.capturedAt)) {
      throw new Error("readback_predates_plan");
    }
    if (assessment.classification === "exact_v30_base") {
      if (snapshot.catalog.length !== plan.basisCatalogCount
        || digestRows(snapshot.catalog) !== plan.basisCatalogSha256
        || digestLedger(snapshot.migrations) !== plan.basisMigrationLedgerSha256
        || canonicalJson(snapshot.tableCounts) !== canonicalJson(plan.basisTableCounts)) {
        throw new Error("base_state_changed");
      }
      return result("classified", {
        classification: "not_installed",
        planSha256: plan.planSha256,
        reasonCodes: ["readback_only_no_retry"],
      });
    }
    if (snapshot.catalog.length !== plan.expectedAfterCatalogCount
      || digestRows(snapshot.catalog) !== plan.expectedAfterCatalogSha256
      || snapshot.migrations.length !== plan.expectedAfterMigrationCount
      || canonicalJson(snapshot.tableCounts) !== canonicalJson(plan.expectedAfterTableCounts)) {
      throw new Error("postcondition_mismatch");
    }
    return result("classified", {
      classification: "installed_schema_migration_only",
      planSha256: plan.planSha256,
      catalogCount: snapshot.catalog.length,
      catalogSha256: digestRows(snapshot.catalog),
      migrationCount: snapshot.migrations.length,
      migrationLedgerSha256: digestLedger(snapshot.migrations),
      tableCountsSha256: sha256(canonicalJson(snapshot.tableCounts)),
      reasonCodes: ["readback_only_no_authority_promotion"],
    });
  } catch (error) {
    return result("refused", {
      classification: "indeterminate",
      reasonCodes: [error?.message || "outcome_classification_failed"],
    });
  }
}

export const crmContactProfileSchemaReadbackQueries = crmSchemaReadbackQueries;

function cli() {
  const command = process.argv[2];
  const artifact = createCrmContactProfileSchemaArtifact();
  if (command === "artifact-sql") {
    process.stdout.write(artifact.sql);
    return;
  }
  if (command === "artifact-manifest") {
    const { sql: _sql, ...manifest } = artifact;
    const transform = deriveCrmContactProfileCatalogTransform();
    process.stdout.write(`${JSON.stringify({
      ...manifest,
      catalogTransform: {
        addedCount: transform.addedCount,
        addedSha256: transform.addedSha256,
        changedCount: transform.changedCount,
        changedBeforeSha256: transform.changedBeforeSha256,
        changedAfterSha256: transform.changedAfterSha256,
      },
    }, null, 2)}\n`);
    return;
  }
  if (command === "artifact-import-manifest") {
    process.stdout.write(`${JSON.stringify(createCrmContactProfileSchemaImportTransport(), null, 2)}\n`);
    return;
  }
  process.stderr.write("Usage: node scripts/crm-contact-profile-schema-install-plan.mjs artifact-sql|artifact-manifest|artifact-import-manifest\n");
  process.exitCode = 64;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
