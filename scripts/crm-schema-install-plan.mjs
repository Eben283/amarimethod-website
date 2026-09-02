// OFFLINE ONLY. This module reads reviewed migration bytes and reasons over
// caller-supplied or local SQLite metadata. It has no Cloudflare client,
// credential access, provider adapter, deployment path, or database write path.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../functions/lib/automation-truth-phase-b.js";

export const CRM_SCHEMA_INSTALL_CONTRACT = "crm-schema-install-plan.v2";
export const CRM_DATABASE = Object.freeze({
  id: "91a5a51d-0319-4c6d-9a6b-36bee3805e62",
  name: "amari-crm-mirror",
});
export const CRM_PRODUCTION_V22_BOUNDARY = Object.freeze({
  catalogCount: 239,
  catalogSha256: "6c290183353d3b3843228efc11875223b0c84e820ac245de0fd5d34b7c6fb7cd",
  catalogDigestMode: "normalized_sql_whitespace_v1",
  migrationCount: 24,
  lastMigration: "0022_partnership_discovery_service.sql",
});

const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
const MIGRATIONS_DIRECTORY = new URL("../crm-mirror-worker/migrations/", import.meta.url);
const TARGET_MIGRATIONS = Object.freeze([
  ["0023_owned_quiz_intake.sql", "21a1e2fbcc80efec4bdf4e4b069fa0f0b3c633af21561589449d7dd3bc3a6cfd"],
  ["0024_owned_email_dispatch_control.sql", "ea1f45f39590f39554467878d9423ebefd19f6045a920cb0ecbc356454e85f9c"],
  ["0025_appointment_recovery_requests.sql", "328351df7d3a7d10a8ec0bf1c4cd93f3d26966296ab580bf13abccb53f9f9b08"],
  ["0026_owned_missed_appointment_truth.sql", "00c9f211bca0ae9a80d43271e6079c821f9c4c9f68df7c9681ef8c1bba8abcb4"],
  ["0027_owned_appointment_attendance.sql", "da9cb5c76ec6a2cea633ec015108c354f0765314d139247cd42967fa5b49c6be"],
  ["0028_owned_note_authority.sql", "45445b92e547f5877c9c4fa70ed13e1e77488645918a81d3e59226689200ed60"],
  ["0029_owned_task_authority.sql", "6c091cf732da18fa6fb39f850f745e4238df90a4f2aaa73a80672519a9fa7fe7"],
  ["0030_owned_contact_classifications.sql", "5a88d587f02590fb6ca42b04f90912ebd33e5e0eac436cbd20ac8b356812e666"],
]);
const TARGET_NAMES = Object.freeze(TARGET_MIGRATIONS.map(([name]) => name));
const TARGET_TABLES = Object.freeze([
  "appointment_attendance_commands",
  "appointment_attendance_events",
  "appointment_recovery_request_events",
  "appointment_recovery_requests",
  "appointment_status_facts",
  "owned_communication_commands",
  "owned_communication_dispatch_events",
  "owned_communication_dispatches",
  "owned_contact_classification_commands",
  "owned_note_versions",
  "owned_task_versions",
  "quiz_intake_submissions",
  "quiz_nurture_dispatches",
]);
const POPULATED_TARGET_TABLE = "appointment_status_facts";
const EXPECTED_ARTIFACT = Object.freeze({
  bytes: 46181,
  sha256: "5be18c203f2fbf6051ad454d0fc84e0335f55a6261ef5b91e0eccc215135fb8e",
});
const EXPECTED_BATCH_REQUEST = Object.freeze({
  statementCount: 101,
  bytes: 48039,
  sha256: "2e4015ee122171177fadec4475beaa74f58b42d263b61324af275a98454bf150",
});
const EXPECTED_DELTA = Object.freeze({
  count: 117,
  sha256: "506daf9eb086b8462f5d4a8e37132244812d9b5495a4936150e90720d1e2214f",
});
const BASELINE_FILE_COUNT = 22;
const BASELINE_CATALOG_COUNT = 229;
const TARGET_LOCAL_CATALOG_COUNT = 346;
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
const catalogKey = (row) => `${row.type}:${row.name}`;
const sortedCatalog = (rows) => [...rows].sort((left, right) =>
  left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
const catalogDigest = (rows) => sha256(canonicalJson(sortedCatalog(rows)));
const migrationDigest = (rows) => sha256(canonicalJson(rows));
const result = (status, extra = {}) => Object.freeze({
  contract: CRM_SCHEMA_INSTALL_CONTRACT,
  ...RESULT_FLAGS,
  status,
  ...extra,
});

function safeIdentifier(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("invalid_table_name");
  return `"${value}"`;
}

function exactObject(value, keys, code = "invalid_input") {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000") !== [...keys].sort().join("\u0000")) throw new Error(code);
}

function validRevision(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function migrationFiles(through = 30) {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, 4)) <= through)
    .sort((left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4)) || left.localeCompare(right));
}

function readTargetMigrations() {
  return TARGET_MIGRATIONS.map(([name, expectedSha256]) => {
    const sql = readFileSync(new URL(name, MIGRATIONS_DIRECTORY), "utf8");
    const actualSha256 = sha256(sql);
    if (actualSha256 !== expectedSha256) throw new Error(`migration_hash_mismatch:${name}`);
    return Object.freeze({ name, sha256: actualSha256, bytes: Buffer.byteLength(sql), sql });
  });
}

function ledgerInsert(name) {
  return `INSERT INTO d1_migrations (name) VALUES ('${name}');\n`;
}

/** Exact reviewed bytes plus exactly one Wrangler-compatible ledger insert per migration. */
export function createCrmSchemaInstallArtifact() {
  const migrations = readTargetMigrations();
  const sql = migrations.map((migration) =>
    migration.sql + (migration.sql.endsWith("\n") ? "" : "\n") + ledgerInsert(migration.name)).join("");
  const bytes = Buffer.byteLength(sql);
  const artifactSha256 = sha256(sql);
  if (bytes !== EXPECTED_ARTIFACT.bytes || artifactSha256 !== EXPECTED_ARTIFACT.sha256) {
    throw new Error("install_artifact_mismatch");
  }
  return Object.freeze({
    contract: CRM_SCHEMA_INSTALL_CONTRACT,
    database: CRM_DATABASE,
    fromMigration: CRM_PRODUCTION_V22_BOUNDARY.lastMigration,
    throughMigration: TARGET_NAMES.at(-1),
    migrationCount: migrations.length,
    migrations: Object.freeze(migrations.map(({ name, sha256: digest, bytes: size }) =>
      Object.freeze({ name, sha256: digest, bytes: size }))),
    sql,
    bytes,
    sha256: artifactSha256,
    statementScope: "exact_migration_bytes_plus_eight_d1_migrations_inserts",
    ...RESULT_FLAGS,
  });
}

/** Split reviewed SQLite text only at complete top-level statement boundaries. */
export function splitCrmSchemaSqlStatements(sql) {
  if (typeof sql !== "string" || !sql.trim()) throw new Error("invalid_install_sql");
  const statements = [];
  let current = "";
  let word = "";
  let statementWordCount = 0;
  let compoundDepth = 0;
  let mode = null;

  const finishWord = () => {
    if (!word) return;
    const token = word.toUpperCase();
    if (statementWordCount === 0 && ["BEGIN", "COMMIT", "ROLLBACK", "END"].includes(token)) {
      throw new Error("explicit_transaction_not_allowed");
    }
    if (token === "BEGIN" || token === "CASE") compoundDepth += 1;
    if (token === "END") {
      if (compoundDepth === 0) throw new Error("unexpected_compound_end");
      compoundDepth -= 1;
    }
    statementWordCount += 1;
    word = "";
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    current += char;
    if (mode === "line_comment") {
      if (char === "\n") mode = null;
      continue;
    }
    if (mode === "block_comment") {
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        mode = null;
      }
      continue;
    }
    if (mode) {
      const marker = mode === "bracket" ? "]" : mode;
      if (char === marker) {
        if (mode !== "bracket" && next === marker) {
          current += next;
          index += 1;
        } else {
          mode = null;
        }
      }
      continue;
    }
    if (char === "-" && next === "-") {
      finishWord();
      current += next;
      index += 1;
      mode = "line_comment";
      continue;
    }
    if (char === "/" && next === "*") {
      finishWord();
      current += next;
      index += 1;
      mode = "block_comment";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      finishWord();
      mode = char;
      continue;
    }
    if (char === "[") {
      finishWord();
      mode = "bracket";
      continue;
    }
    if (/[A-Za-z0-9_]/.test(char)) {
      word += char;
      continue;
    }
    finishWord();
    if (char === ";" && compoundDepth === 0) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      statementWordCount = 0;
    }
  }
  finishWord();
  if (mode === "block_comment" || mode === "'" || mode === '"' || mode === "`" || mode === "bracket"
    || compoundDepth !== 0) throw new Error("incomplete_install_sql");
  if (current.trim()) statements.push(current.trim());
  if (statements.length === 0) throw new Error("empty_install_batch");
  return Object.freeze(statements);
}

/** Exact one-HTTP-request D1 REST batch body; no credential or transport path. */
export function createCrmSchemaInstallBatchRequest() {
  const artifact = createCrmSchemaInstallArtifact();
  const statements = splitCrmSchemaSqlStatements(artifact.sql);
  const body = Object.freeze({ batch: Object.freeze(statements.map((sql) => Object.freeze({ sql }))) });
  const json = canonicalJson(body);
  const request = Object.freeze({
    kind: "d1_rest_query_batch_v1",
    endpoint: "query",
    statementCount: statements.length,
    bytes: Buffer.byteLength(json),
    sha256: sha256(json),
    body,
  });
  if (request.statementCount !== EXPECTED_BATCH_REQUEST.statementCount
    || request.bytes !== EXPECTED_BATCH_REQUEST.bytes || request.sha256 !== EXPECTED_BATCH_REQUEST.sha256) {
    throw new Error("install_batch_request_mismatch");
  }
  return request;
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

/** Derives the additive catalog from real SQLite execution, then checks its pinned identity. */
export function deriveCrmSchemaCatalogDelta() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    createLedger(db);
    const baseline = migrationFiles(22);
    if (baseline.length !== BASELINE_FILE_COUNT) throw new Error("baseline_migration_set_mismatch");
    for (const name of baseline) db.exec(readFileSync(new URL(name, MIGRATIONS_DIRECTORY), "utf8"));
    const before = schemaRows(db);
    if (before.length !== BASELINE_CATALOG_COUNT) throw new Error("baseline_catalog_mismatch");
    const beforeKeys = new Set(before.map(catalogKey));
    for (const migration of readTargetMigrations()) db.exec(migration.sql);
    const after = schemaRows(db);
    if (after.length !== TARGET_LOCAL_CATALOG_COUNT) throw new Error("target_catalog_mismatch");
    const delta = sortedCatalog(after.filter((row) => !beforeKeys.has(catalogKey(row))));
    if (delta.length !== EXPECTED_DELTA.count || catalogDigest(delta) !== EXPECTED_DELTA.sha256) {
      throw new Error("catalog_delta_mismatch");
    }
    return Object.freeze({
      rows: Object.freeze(delta.map((row) => Object.freeze({ ...row }))),
      count: delta.length,
      sha256: catalogDigest(delta),
    });
  } finally {
    db.close();
  }
}

function userTableNames(catalog) {
  return catalog.filter((row) => row.type === "table"
    && row.name !== "d1_migrations"
    && !row.name.startsWith("sqlite_")
    && !row.name.startsWith("_cf_"))
    .map((row) => row.name).sort();
}

function normalizeQuickCheck(rows) {
  return rows.map((row) => String(Object.values(row)[0])).sort();
}

/** Local-fixture helper. It cannot authenticate Cloudflare or authorize execution. */
export function captureLocalCrmSchemaSnapshot(db, options = {}) {
  const catalog = schemaRows(db);
  const tables = userTableNames(catalog);
  const tableCounts = Object.fromEntries(tables.map((name) => [
    name,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${safeIdentifier(name)}`).get().count),
  ]));
  const hasLedger = catalog.some((row) => row.type === "table" && row.name === "d1_migrations");
  const migrations = hasLedger
    ? db.prepare("SELECT id,name,applied_at FROM d1_migrations ORDER BY id").all()
    : [];
  return Object.freeze({
    databaseId: options.databaseId || "local-fixture",
    databaseName: options.databaseName || "local-fixture",
    environment: options.environment || "local",
    evidenceScope: "local_sqlite_fixture",
    capturedAt: options.capturedAt || Date.now(),
    servedByPrimary: false,
    readReplicationEnabled: false,
    catalog: Object.freeze(catalog.map((row) => Object.freeze({ ...row }))),
    migrations: Object.freeze(migrations.map((row) => Object.freeze({ ...row }))),
    tableCounts: Object.freeze(tableCounts),
    foreignKeysEnabled: Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys) === 1,
    foreignKeyViolations: Object.freeze(db.prepare("PRAGMA foreign_key_check").all()),
    quickCheck: Object.freeze(normalizeQuickCheck(db.prepare("PRAGMA quick_check").all())),
  });
}

function validateCatalog(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error("invalid_catalog");
  const keys = new Set();
  for (const row of rows) {
    exactObject(row, ["type", "name", "tbl_name", "sql"], "invalid_catalog");
    if (!["table", "index", "trigger", "view"].includes(row.type)
      || typeof row.name !== "string" || !row.name
      || typeof row.tbl_name !== "string" || !row.tbl_name
      || (row.sql !== null && typeof row.sql !== "string")) throw new Error("invalid_catalog");
    const key = catalogKey(row);
    if (keys.has(key)) throw new Error("invalid_catalog");
    keys.add(key);
  }
}

/** Matches the established production-boundary fingerprint while ignoring SQL formatting only. */
export function normalizedCrmCatalogDigest(rows) {
  validateCatalog(rows);
  const normalized = rows.map(({ type, name, tbl_name, sql }) => ({
    type,
    name,
    tbl_name,
    sql: typeof sql === "string" ? sql.replace(/\s+/g, " ").trim() : null,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return sha256(JSON.stringify(normalized));
}

function validateSnapshot(snapshot) {
  exactObject(snapshot, ["databaseId", "databaseName", "environment", "evidenceScope", "capturedAt",
    "servedByPrimary", "readReplicationEnabled", "catalog", "migrations", "tableCounts",
    "foreignKeysEnabled", "foreignKeyViolations", "quickCheck"], "invalid_snapshot");
  if (!Number.isSafeInteger(snapshot.capturedAt) || snapshot.capturedAt < 1) throw new Error("invalid_snapshot");
  validateCatalog(snapshot.catalog);
  if (!Array.isArray(snapshot.migrations) || !snapshot.migrations.length) throw new Error("invalid_migration_ledger");
  let previousId = 0;
  for (const row of snapshot.migrations) {
    exactObject(row, ["id", "name", "applied_at"], "invalid_migration_ledger");
    if (!Number.isSafeInteger(row.id) || row.id <= previousId || typeof row.name !== "string" || !row.name
      || typeof row.applied_at !== "string" || !row.applied_at) throw new Error("invalid_migration_ledger");
    previousId = row.id;
  }
  if (!snapshot.tableCounts || typeof snapshot.tableCounts !== "object" || Array.isArray(snapshot.tableCounts)) {
    throw new Error("invalid_table_counts");
  }
  const expectedTables = userTableNames(snapshot.catalog);
  if (Object.keys(snapshot.tableCounts).sort().join("\u0000") !== expectedTables.join("\u0000")) {
    throw new Error("invalid_table_counts");
  }
  for (const count of Object.values(snapshot.tableCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid_table_counts");
  }
  if (snapshot.foreignKeysEnabled !== true || !Array.isArray(snapshot.foreignKeyViolations)
    || !Array.isArray(snapshot.quickCheck)) throw new Error("invalid_integrity_readback");
}

function integrityReason(snapshot) {
  if (!snapshot.foreignKeysEnabled) return "foreign_keys_disabled";
  if (snapshot.foreignKeyViolations.length) return "foreign_key_violation";
  if (snapshot.quickCheck.length !== 1 || snapshot.quickCheck[0] !== "ok") return "quick_check_failed";
  return null;
}

function targetCatalogState(catalog, delta) {
  const deltaByKey = new Map(delta.rows.map((row) => [catalogKey(row), row]));
  const found = catalog.filter((row) => deltaByKey.has(catalogKey(row)));
  if (!found.length) return { state: "absent", base: sortedCatalog(catalog) };
  if (found.length !== delta.count) return { state: "partial" };
  for (const row of found) {
    if (canonicalJson(row) !== canonicalJson(deltaByKey.get(catalogKey(row)))) return { state: "conflict" };
  }
  return {
    state: "present",
    base: sortedCatalog(catalog.filter((row) => !deltaByKey.has(catalogKey(row)))),
  };
}

function baseLedger(snapshot) {
  const rows = snapshot.migrations;
  return rows.length === CRM_PRODUCTION_V22_BOUNDARY.migrationCount
    && rows.at(-1).name === CRM_PRODUCTION_V22_BOUNDARY.lastMigration
    && !rows.some((row) => TARGET_NAMES.includes(row.name));
}

function targetLedger(snapshot) {
  const rows = snapshot.migrations;
  if (rows.length !== CRM_PRODUCTION_V22_BOUNDARY.migrationCount + TARGET_NAMES.length) return false;
  const prefix = rows.slice(0, CRM_PRODUCTION_V22_BOUNDARY.migrationCount);
  const suffix = rows.slice(CRM_PRODUCTION_V22_BOUNDARY.migrationCount);
  return prefix.at(-1)?.name === CRM_PRODUCTION_V22_BOUNDARY.lastMigration
    && suffix.every((row, index) => row.name === TARGET_NAMES[index]
      && row.id === prefix.at(-1).id + index + 1);
}

/** Fail-closed production boundary classifier over caller-supplied readback. */
export function assessCrmSchemaSnapshot(snapshot) {
  try {
    validateSnapshot(snapshot);
    if (snapshot.databaseId !== CRM_DATABASE.id || snapshot.databaseName !== CRM_DATABASE.name
      || snapshot.environment !== "production") throw new Error("wrong_database");
    const integrity = integrityReason(snapshot);
    if (integrity) throw new Error(integrity);
    if (!snapshot.servedByPrimary || snapshot.readReplicationEnabled !== false
      || snapshot.evidenceScope !== "production_d1_primary_readback") throw new Error("primary_readback_unproven");
    const delta = deriveCrmSchemaCatalogDelta();
    const catalogState = targetCatalogState(snapshot.catalog, delta);
    if (["partial", "conflict"].includes(catalogState.state)) throw new Error(`${catalogState.state}_installation`);
    if (catalogState.base.length !== CRM_PRODUCTION_V22_BOUNDARY.catalogCount
      || normalizedCrmCatalogDigest(catalogState.base) !== CRM_PRODUCTION_V22_BOUNDARY.catalogSha256) {
      throw new Error("base_catalog_mismatch");
    }
    if (catalogState.state === "absent" && !baseLedger(snapshot)) throw new Error("base_ledger_mismatch");
    if (catalogState.state === "present" && !targetLedger(snapshot)) throw new Error("target_ledger_mismatch");
    return result("proven", {
      classification: catalogState.state === "absent" ? "exact_v22_base" : "exact_v30_catalog_and_ledger",
      catalogCount: snapshot.catalog.length,
      catalogSha256: catalogDigest(snapshot.catalog),
      migrationCount: snapshot.migrations.length,
      migrationLedgerSha256: migrationDigest(snapshot.migrations),
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "snapshot_assessment_failed"] });
  }
}

function expectedTargetCounts(before) {
  const counts = { ...before.tableCounts };
  for (const table of TARGET_TABLES) counts[table] = table === POPULATED_TARGET_TABLE
    ? before.tableCounts.appointments
    : 0;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

/** Exact local or captured before/after proof; neither snapshot grants write authority. */
export function verifyCrmSchemaTransition(before, after) {
  try {
    validateSnapshot(before);
    validateSnapshot(after);
    if (before.databaseId !== after.databaseId || before.databaseName !== after.databaseName
      || before.environment !== after.environment || after.capturedAt < before.capturedAt) throw new Error("snapshot_identity_mismatch");
    const beforeIntegrity = integrityReason(before);
    const afterIntegrity = integrityReason(after);
    if (beforeIntegrity) throw new Error(`before_${beforeIntegrity}`);
    if (afterIntegrity) throw new Error(`after_${afterIntegrity}`);
    const delta = deriveCrmSchemaCatalogDelta();
    if (targetCatalogState(before.catalog, delta).state !== "absent") throw new Error("target_not_absent_before");
    const afterState = targetCatalogState(after.catalog, delta);
    if (afterState.state !== "present") throw new Error(`${afterState.state}_installation`);
    if (canonicalJson(afterState.base) !== canonicalJson(sortedCatalog(before.catalog))) throw new Error("base_catalog_changed");
    if (after.migrations.length !== before.migrations.length + TARGET_NAMES.length
      || canonicalJson(after.migrations.slice(0, before.migrations.length)) !== canonicalJson(before.migrations)) {
      throw new Error("migration_ledger_prefix_changed");
    }
    const lastId = before.migrations.at(-1).id;
    const suffix = after.migrations.slice(before.migrations.length);
    if (!suffix.every((row, index) => row.id === lastId + index + 1 && row.name === TARGET_NAMES[index])) {
      throw new Error("migration_ledger_suffix_mismatch");
    }
    const expectedCounts = expectedTargetCounts(before);
    if (canonicalJson(after.tableCounts) !== canonicalJson(expectedCounts)) throw new Error("table_count_mismatch");
    return result("verified", {
      classification: "exact_schema_only_v22_to_v30_transition",
      beforeCatalogCount: before.catalog.length,
      beforeCatalogSha256: catalogDigest(before.catalog),
      afterCatalogCount: after.catalog.length,
      afterCatalogSha256: catalogDigest(after.catalog),
      additiveCatalogCount: delta.count,
      additiveCatalogSha256: delta.sha256,
      beforeMigrationLedgerSha256: migrationDigest(before.migrations),
      afterMigrationLedgerSha256: migrationDigest(after.migrations),
      preservedTableCountsSha256: sha256(canonicalJson(before.tableCounts)),
      targetTableCounts: Object.freeze(Object.fromEntries(TARGET_TABLES.map((name) => [name, after.tableCounts[name]]))),
      reasonCodes: ["readback_only_no_authority_promotion"],
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "transition_verification_failed"] });
  }
}

function validateRecovery(recovery, now) {
  exactObject(recovery, ["databaseId", "source", "bookmark", "capturedAt", "externalRecordId", "owner"], "invalid_recovery_metadata");
  if (recovery.databaseId !== CRM_DATABASE.id || recovery.source !== "cloudflare_time_travel"
    || typeof recovery.bookmark !== "string"
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{8}){2}-[0-9a-f]{32}$/.test(recovery.bookmark)
    || typeof recovery.externalRecordId !== "string" || !recovery.externalRecordId
    || typeof recovery.owner !== "string" || !recovery.owner
    || !Number.isSafeInteger(recovery.capturedAt)) throw new Error("invalid_recovery_metadata");
  if (recovery.capturedAt > now || now - recovery.capturedAt > MAX_SNAPSHOT_AGE_MS) throw new Error("recovery_metadata_not_fresh");
}

export function assessCrmSchemaRecovery(recovery, now = Date.now()) {
  try {
    validateRecovery(recovery, now);
    return result("proven", {
      classification: "fresh_external_time_travel_recovery_metadata",
      databaseId: recovery.databaseId,
      capturedAt: recovery.capturedAt,
      evidenceScope: "caller_supplied_metadata_not_authenticated",
      reasonCodes: ["recovery_bookmark_not_authenticated_by_offline_plan"],
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "invalid_recovery_metadata"] });
  }
}

/** Caller metadata can make a reviewed plan structurally ready, never authorized to execute. */
export function planCrmSchemaInstall(options) {
  try {
    exactObject(options, ["sourceRevision", "snapshot", "recovery"]);
    if (!validRevision(options.sourceRevision)) throw new Error("invalid_source_revision");
    if (options.snapshot === null) return result("pending", { reasonCodes: ["missing_primary_snapshot"] });
    const assessment = assessCrmSchemaSnapshot(options.snapshot);
    if (assessment.status !== "proven") return result("refused", { reasonCodes: assessment.reasonCodes });
    if (assessment.classification === "exact_v30_catalog_and_ledger") {
      return result("already_installed", { reasonCodes: ["readback_only_no_replay"] });
    }
    const now = Date.now();
    if (options.snapshot.capturedAt > now || now - options.snapshot.capturedAt > MAX_SNAPSHOT_AGE_MS) {
      return result("pending", { reasonCodes: ["snapshot_not_fresh"] });
    }
    if (options.recovery === null) return result("pending", { reasonCodes: ["missing_recovery_metadata"] });
    validateRecovery(options.recovery, now);
    const artifact = createCrmSchemaInstallArtifact();
    const batchRequest = createCrmSchemaInstallBatchRequest();
    const delta = deriveCrmSchemaCatalogDelta();
    const afterCatalog = sortedCatalog([...options.snapshot.catalog, ...delta.rows]);
    const body = {
      contract: CRM_SCHEMA_INSTALL_CONTRACT,
      database: CRM_DATABASE,
      sourceRevision: options.sourceRevision,
      basisCapturedAt: options.snapshot.capturedAt,
      basisCatalogCount: options.snapshot.catalog.length,
      basisCatalogSha256: catalogDigest(options.snapshot.catalog),
      basisMigrationLedgerSha256: migrationDigest(options.snapshot.migrations),
      basisTableCounts: options.snapshot.tableCounts,
      recovery: options.recovery,
      artifact: { sha256: artifact.sha256, bytes: artifact.bytes, migrations: artifact.migrations },
      transport: {
        kind: batchRequest.kind,
        endpoint: batchRequest.endpoint,
        statementCount: batchRequest.statementCount,
        bytes: batchRequest.bytes,
        sha256: batchRequest.sha256,
      },
      expectedAfterCatalogCount: afterCatalog.length,
      expectedAfterCatalogSha256: catalogDigest(afterCatalog),
      expectedAfterMigrationCount: options.snapshot.migrations.length + TARGET_NAMES.length,
      expectedAfterTableCounts: expectedTargetCounts(options.snapshot),
    };
    return result("planned", {
      ...body,
      planSha256: sha256(canonicalJson(body)),
      evidenceScope: "caller_supplied_metadata_not_authenticated",
      reasonCodes: [
        "separate_exact_execution_approval_required",
        "fresh_primary_revalidation_required_at_execution",
        "recovery_bookmark_not_authenticated_by_offline_plan",
        "single_transaction_batch_requires_execution_readback",
        "immediate_read_only_primary_readback_required",
      ],
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "install_plan_unavailable"] });
  }
}

function planIdentityBody(plan) {
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

/**
 * Classifies a fresh primary readback after an attempted installation. A lost
 * response is never retried: exact v22 means not installed, exact v30 plus all
 * preservation proofs means installed, and every other state is indeterminate.
 */
export function classifyCrmSchemaInstallOutcome(options) {
  try {
    exactObject(options, ["plan", "snapshot"]);
    const { plan, snapshot } = options;
    if (!plan || plan.status !== "planned" || plan.contract !== CRM_SCHEMA_INSTALL_CONTRACT
      || plan.planSha256 !== sha256(canonicalJson(planIdentityBody(plan)))) throw new Error("invalid_plan_identity");
    if (snapshot === null) return result("pending", {
      classification: "indeterminate",
      reasonCodes: ["missing_primary_snapshot"],
    });
    const assessment = assessCrmSchemaSnapshot(snapshot);
    if (assessment.status !== "proven") return result("refused", {
      classification: "indeterminate",
      reasonCodes: assessment.reasonCodes,
    });
    const now = Date.now();
    if (snapshot.capturedAt > now || now - snapshot.capturedAt > MAX_SNAPSHOT_AGE_MS) return result("pending", {
      classification: "indeterminate",
      reasonCodes: ["snapshot_not_fresh"],
    });
    if (snapshot.capturedAt < Math.max(plan.basisCapturedAt, plan.recovery.capturedAt)) {
      throw new Error("readback_predates_plan");
    }
    if (assessment.classification === "exact_v22_base") {
      if (snapshot.catalog.length !== plan.basisCatalogCount
        || catalogDigest(snapshot.catalog) !== plan.basisCatalogSha256
        || migrationDigest(snapshot.migrations) !== plan.basisMigrationLedgerSha256
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
      || catalogDigest(snapshot.catalog) !== plan.expectedAfterCatalogSha256
      || snapshot.migrations.length !== plan.expectedAfterMigrationCount
      || canonicalJson(snapshot.tableCounts) !== canonicalJson(plan.expectedAfterTableCounts)) {
      throw new Error("postcondition_mismatch");
    }
    return result("classified", {
      classification: "installed_schema_migrations_only",
      planSha256: plan.planSha256,
      catalogCount: snapshot.catalog.length,
      catalogSha256: catalogDigest(snapshot.catalog),
      migrationCount: snapshot.migrations.length,
      migrationLedgerSha256: migrationDigest(snapshot.migrations),
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

export function crmSchemaReadbackQueries(catalog = null) {
  const fixed = Object.freeze({
    catalog: "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('table','index','trigger','view') ORDER BY type,name",
    migrations: "SELECT id,name,applied_at FROM d1_migrations ORDER BY id",
    foreignKeysEnabled: "PRAGMA foreign_keys",
    foreignKeyViolations: "PRAGMA foreign_key_check",
    quickCheck: "PRAGMA quick_check",
  });
  if (catalog === null) return Object.freeze({ fixed, tableCounts: [] });
  validateCatalog(catalog);
  return Object.freeze({
    fixed,
    tableCounts: Object.freeze(userTableNames(catalog).map((name) => Object.freeze({
      table: name,
      sql: `SELECT COUNT(*) AS count FROM ${safeIdentifier(name)}`,
    }))),
  });
}

function cli() {
  const command = process.argv[2];
  const artifact = createCrmSchemaInstallArtifact();
  if (command === "artifact-sql") {
    process.stdout.write(artifact.sql);
    return;
  }
  if (command === "artifact-manifest") {
    const { sql: _sql, ...manifest } = artifact;
    const delta = deriveCrmSchemaCatalogDelta();
    process.stdout.write(`${JSON.stringify({ ...manifest, additiveCatalog: { count: delta.count, sha256: delta.sha256 } }, null, 2)}\n`);
    return;
  }
  if (command === "artifact-batch-manifest") {
    const { body: _body, ...manifest } = createCrmSchemaInstallBatchRequest();
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  if (command === "artifact-batch-json") {
    process.stdout.write(canonicalJson(createCrmSchemaInstallBatchRequest().body));
    return;
  }
  process.stderr.write("Usage: node scripts/crm-schema-install-plan.mjs artifact-sql|artifact-manifest|artifact-batch-manifest|artifact-batch-json\n");
  process.exitCode = 64;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
