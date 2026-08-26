import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  RELIABILITY_SCHEMA_V1,
  RELIABILITY_SCHEMA_V1_LOCAL_CANDIDATE,
  RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE,
  assessReliabilityStructure,
  assessReliabilityV2MigrationPreflight,
  assertReliabilityV2MigrationPreflight,
  assertReliabilityV2Postflight,
  readReliabilitySchemaAuthority,
} from "../../functions/lib/reliability-schema-authority.js";
import { readReliabilityHealth } from "../../functions/lib/reliability-store.js";

const base = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const candidate = readFileSync(new URL("../reliability-spine-v2.local.sql", import.meta.url), "utf8");
const promotion = readFileSync(new URL("../reliability-spine-v2-promote.local.sql", import.meta.url), "utf8");
const productionV1Fixture = JSON.parse(readFileSync(new URL(
  "../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json",
  import.meta.url,
), "utf8"));
const MIGRATION_ID = RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.migrationId;
const MIGRATION_DESCRIPTION = RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.description;
const EXPECTED_OBJECTS = RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.expectedObjects;
const PROSPECTIVE_LIVE_V2_DIGEST = "8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62";

const hex = (character, length = 64) => character.repeat(length);
// v1 preserves every byte that can affect a quoted SQL literal. Only transport
// line endings are normalized before hashing the exact sqlite_master SQL.
const normalizeDdl = (sql) => String(sql).replace(/\r\n?/g, "\n").trim();

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(base);
  return db;
}

function structureProjection(db) {
  const requiredTables = EXPECTED_OBJECTS.filter((key) => key.startsWith("table:")).map((key) => key.split(":")[1]);
  const placeholders = requiredTables.map(() => "?").join(",");
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name IN (${placeholders}) OR (type IN ('index','trigger') AND tbl_name IN (${placeholders}))
    ORDER BY type,name`).all(...requiredTables, ...requiredTables).filter((row) => !row.name.startsWith("sqlite_autoindex"))
    .map((row) => ({
    type: row.type, name: row.name, table: row.tbl_name, sql: normalizeDdl(row.sql),
  }));
}

function sqliteMasterRows(db) {
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE type IN ('table','index','trigger') ORDER BY type,name`).all();
}

function structureDigest(db) {
  return createHash("sha256").update(JSON.stringify(structureProjection(db))).digest("hex");
}

function declaredStructureDigest() {
  const match = promotion.match(/SELECT 2, 'reliability-spine-v2-deployment-attestation', 'sqlite-master-required-closure\.v1',\s*'([a-f0-9]{64})'/);
  if (!match) throw new Error("candidate schema contract digest missing");
  return match[1];
}

function productionJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionJavaScriptFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) return [];
    return [path];
  });
}

function productionV1Rows() {
  return productionV1Fixture.projection.map((row) => ({
    type: row.type, name: row.name, tbl_name: row.table, sql: row.sql,
  }));
}

function d1FromSqlite(raw, { sqliteMasterRows = null, schemaMarkers = null } = {}) {
  return {
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        first() { return raw.prepare(sql).get(...this.values) || null; },
        all() {
          if (sqliteMasterRows && /\bFROM\s+sqlite_master\b/i.test(sql)) {
            return { results: sqliteMasterRows.map((row) => ({ ...row })) };
          }
          if (schemaMarkers && /\bFROM\s+reliability_schema_versions\b/i.test(sql)) {
            return { results: schemaMarkers.map((row) => ({ ...row })) };
          }
          return { results: raw.prepare(sql).all(...this.values) };
        },
      };
    },
  };
}

function applyFileTransaction(db, sql) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function installLocalCandidate(db) {
  applyFileTransaction(db, candidate);
}

function promoteLocalCandidate(db) {
  applyFileTransaction(db, promotion);
}

function applyLocalCandidate(db) {
  installLocalCandidate(db);
  promoteLocalCandidate(db);
}

function insertFreshCoverage(db, nowMs = Date.now()) {
  db.prepare(`INSERT INTO reconciliation_runs
    (reconciliation_run_id,family,authority,source_version,runtime_version,started_at,completed_at,
     expected_start,expected_end,coverage_start,coverage_end,pagination_complete,state,retention_until)
    VALUES ('migration-readiness-coverage','follow-up-session-reminders','AUTOMATION_DB','ghl-readback-v1',
      'migration-readiness-test',?,?,?,?,?,?,1,'complete',?)`).run(
    nowMs - 500,
    nowMs - 100,
    nowMs - 900,
    nowMs - 200,
    nowMs - 1_000,
    nowMs - 100,
    nowMs - 500 + 34_560_000_000,
  );
}

function insertRelease(db, patch = {}) {
  const now = Date.now();
  const value = {
    id: `relm_${hex("a")}`, digest: hex("a"), sourceRevision: hex("b", 40), sourceTree: hex("c", 40),
    workerVersion: "worker-v1", runtimeVersion: "runtime-v1",
    lockfile: hex("d"), bundle: hex("e"), modules: hex("f"), compilerArtifact: hex("1"), spec: hex("2"),
    plan: hex("3"), handlers: hex("4"), messages: hex("5"), bindings: hex("6"), workflowVersion: 3,
    workflowDocument: hex("7"), schemaVersion: 2, schemaSource: hex("8"),
    schemaStructure: declaredStructureDigest(), createdAt: now, retentionUntil: now + 60_000, ...patch,
  };
  db.prepare(`INSERT INTO automation_release_manifests
    (release_manifest_id,release_manifest_digest,family,source_repository,source_revision,source_tree,worker_version,runtime_version,lockfile_sha256,
     bundle_sha256,modules_digest,compiler_id,compiler_artifact_sha256,spec_digest,compiled_plan_digest,
     handler_registry_digest,message_catalog_digest,expected_bindings_digest,workflow_id,workflow_version,
     workflow_state,workflow_document_sha256,schema_database_id,schema_migration_id,schema_version,
     schema_source_sha256,schema_structure_sha256,follow_up_delivery_release,follow_up_assigned_user_delivery,
     declared_effect_owner,canonical_json,created_at,retention_until)
    VALUES (?,?, 'follow-up-session-reminders','Eben283/amarimethod-website',?,?,?,?,?,?,?,'compiler',?,?,?,?,?,?,
      'follow-up-session-reminders',?,'published',?,'db',?,?,?,?, 'approved','approved','Amari','{}',?,?)`).run(
    value.id, value.digest, value.sourceRevision, value.sourceTree, value.workerVersion, value.runtimeVersion,
    value.lockfile, value.bundle, value.modules,
    value.compilerArtifact, value.spec, value.plan, value.handlers, value.messages, value.bindings,
    value.workflowVersion, value.workflowDocument, MIGRATION_ID, value.schemaVersion, value.schemaSource,
    value.schemaStructure, value.createdAt, value.retentionUntil,
  );
  return value;
}

function insertAttestation(db, release, patch = {}) {
  const value = {
    id: `depatt_${hex("9")}`, deploymentId: "deployment-1", versionId: "version-1",
    payload: hex("9"), signature: "ab".repeat(64), observedAt: release.createdAt + 1_000,
    attestedAt: release.createdAt + 2_000, recordedAt: release.createdAt + 2_100, expiresAt: release.createdAt + 12_000,
    retentionUntil: release.retentionUntil, ...patch,
  };
  db.prepare(`INSERT INTO automation_deployment_attestations
    (deployment_attestation_id,release_manifest_id,release_manifest_digest,platform,service,environment,
     deployment_id,version_id,traffic_percent,source_revision,source_tree,worker_version,runtime_version,bundle_sha256,modules_digest,
     observed_bindings_digest,schema_database_id,schema_migration_id,schema_version,schema_source_sha256,
     schema_structure_sha256,workflow_id,workflow_version,workflow_document_sha256,follow_up_delivery_release,
     follow_up_assigned_user_delivery,build_evidence_reference,build_evidence_sha256,
     cloudflare_evidence_reference,cloudflare_evidence_sha256,
     d1_schema_evidence_reference,d1_schema_evidence_sha256,d1_workflow_evidence_reference,d1_workflow_evidence_sha256,
     payload_sha256,authentication_method,authentication_key_id,authentication_signature,canonical_json,
     observed_at,attested_at,recorded_at,expires_at,retention_until)
    VALUES (?,?,?,'cloudflare','reminder-engine','production',?,?,100,?,?,?,?,?,?,?,'db',?,?,?,?,
      'follow-up-session-reminders',?,?,'approved','approved','github://build',?,'cf://deployment',?,'d1://schema',?,
      'd1://workflow',?,?,'ed25519','attestor-2026-08',?,'{}',?,?,?,?,?)`).run(
    value.id, release.id, release.digest, value.deploymentId, value.versionId, release.sourceRevision,
    release.sourceTree, release.workerVersion, release.runtimeVersion, release.bundle, release.modules,
    release.bindings, MIGRATION_ID, release.schemaVersion,
    release.schemaSource, release.schemaStructure, release.workflowVersion, release.workflowDocument,
    hex("0"), hex("1"), hex("2"), hex("3"), value.payload, value.signature,
    value.observedAt, value.attestedAt, value.recordedAt, value.expiresAt, value.retentionUntil,
  );
  return value;
}

function insertAcceptedLifecycle(db, {
  sourceId = "source-1", lifecycleId = "lifecycle-1", version = 3,
  runtimeVersion = "runtime-v1", retentionUntil = Date.now() + 60_000,
} = {}) {
  const eventTime = retentionUntil - 60_000;
  db.prepare(`INSERT INTO source_events
    (source_event_id,provider,family,provider_event_id,identity_version,identity_key,payload_sha256,
     normalized_retention_until,occurred_at,received_at,authentication_result,normalization_state,state,
     source_version,runtime_version,accepted_at,created_at)
    VALUES (?, 'ghl','follow-up-session-reminders','provider-1',1,?,?, ?,?,?,'authenticated','normalized',
      'accepted','source-v1',?,?,?)`).run(
    sourceId, `identity-${sourceId}`, hex("a"), retentionUntil, eventTime, eventTime, runtimeVersion, eventTime, eventTime,
  );
  db.prepare(`INSERT INTO lifecycle_instances
    (lifecycle_instance_id,source_event_id,family,scope,person_id,appointment_id,definition_version,
     runtime_version,state,retention_until,created_at,updated_at)
    VALUES (?,?,'follow-up-session-reminders','follow-up','person-1','appointment-1',?,?,'active',?,?,?)`)
    .run(lifecycleId, sourceId, version, runtimeVersion, retentionUntil, eventTime, eventTime);
  db.prepare(`INSERT INTO lifecycle_obligations
    (obligation_id,lifecycle_instance_id,obligation_key,kind,family,deadline_at,owner_role,closer,state,
     retention_until,created_at,updated_at)
    VALUES (?,?, 'confirmation','email','follow-up-session-reminders',?,'system','provider_receipt','pending',?,?,?)`)
    .run(`obligation-${lifecycleId}`, lifecycleId, eventTime + 1_000, retentionUntil, eventTime, eventTime);
  return { sourceId, lifecycleId, retentionUntil };
}

describe("local-only reliability spine v2 deployment-attestation candidate", () => {
  it("proves only the exact observed production-v1 variant and keeps current Staff health output equivalent", async () => {
    const raw = database();
    const liveRows = productionV1Rows();
    const liveDb = d1FromSqlite(raw, {
      sqliteMasterRows: liveRows, schemaMarkers: productionV1Fixture.marker,
    });
    const exactStructure = await assessReliabilityStructure(liveRows, RELIABILITY_SCHEMA_V1);
    expect(productionV1Fixture).toMatchObject({
      variantId: RELIABILITY_SCHEMA_V1.variantId,
      objectCount: 49,
      structureSha256: RELIABILITY_SCHEMA_V1.structureSha256,
      readEvidence: {
        servedBy: "v3-prod", servedByPrimary: true, markerRowsWritten: 0, structureRowsWritten: 0,
      },
    });
    expect(productionV1Fixture.sourceProvenance.baseTablesCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(productionV1Fixture.sourceProvenance.definitionVersionCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(productionV1Fixture.differencesFromCleanBootstrap.map((row) => row.key)).toEqual([
      "index:idx_evt_engine_flow", "table:automation_events", "table:reminder_enrollments",
    ]);
    expect(exactStructure).toMatchObject({
      proven: true, digest: RELIABILITY_SCHEMA_V1.structureSha256,
      expectedDigest: RELIABILITY_SCHEMA_V1.structureSha256,
    });
    expect(exactStructure.objects).toEqual(RELIABILITY_SCHEMA_V1.expectedObjects);
    const exactAuthority = await readReliabilitySchemaAuthority(liveDb);
    expect(exactAuthority).toMatchObject({
      proven: true,
      reason: "schema_v1_exact_authority",
      version: 1,
      variantId: "production-live-v1-f7af1024",
      migrationState: "current_v1",
    });
    const nowMs = Date.now();
    insertFreshCoverage(raw, nowMs);
    await expect(readReliabilityHealth(liveDb, {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({ truth: "Known", reason: "authoritative_and_fresh", schemaVersion: 1 });

    const localStructure = await assessReliabilityStructure(
      sqliteMasterRows(raw), RELIABILITY_SCHEMA_V1_LOCAL_CANDIDATE,
    );
    expect(localStructure).toMatchObject({
      proven: true,
      digest: "cd57730cfbf6a04cc3db670e0b299a27041191e880684eb86acd134ab734f5a2",
    });
    await expect(readReliabilitySchemaAuthority(d1FromSqlite(raw))).resolves.toMatchObject({
      proven: false, reason: "schema_v1_marker_mismatch", version: 1,
    });

    const wrongMarker = database();
    wrongMarker.prepare("UPDATE reliability_schema_versions SET description='wrong'").run();
    await expect(readReliabilityHealth(d1FromSqlite(wrongMarker, { sqliteMasterRows: liveRows }), {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven", schemaReason: "schema_v1_marker_mismatch", schemaVersion: 1,
    });

    const wrongAppliedAt = database();
    wrongAppliedAt.prepare("UPDATE reliability_schema_versions SET applied_at=1").run();
    await expect(readReliabilityHealth(d1FromSqlite(wrongAppliedAt, { sqliteMasterRows: liveRows }), {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven", schemaReason: "schema_v1_marker_mismatch", schemaVersion: 1,
    });

    const wrongV1Rows = liveRows.map((row) => row.name === "idx_evt_engine_flow"
      ? { ...row, sql: row.sql.replace("  ON", "   ON") }
      : row);
    await expect(readReliabilityHealth(d1FromSqlite(raw, {
      sqliteMasterRows: wrongV1Rows, schemaMarkers: productionV1Fixture.marker,
    }), {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven", schemaReason: "schema_v1_structure_mismatch", schemaVersion: 1,
    });

    const partialV2Rows = [...liveRows, {
      type: "table", name: "automation_release_manifests",
      tbl_name: "automation_release_manifests", sql: "CREATE TABLE automation_release_manifests (wrong TEXT)",
    }];
    await expect(readReliabilityHealth(d1FromSqlite(raw, {
      sqliteMasterRows: partialV2Rows, schemaMarkers: productionV1Fixture.marker,
    }), {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven", schemaReason: "schema_v2_partial_or_conflicting", schemaVersion: 1,
    });
  });

  it("blocks production preflight because the additive live-v1 result cannot attain the local b289 target", async () => {
    const raw = database();
    const liveRows = productionV1Rows();
    const liveDb = d1FromSqlite(raw, {
      sqliteMasterRows: liveRows, schemaMarkers: productionV1Fixture.marker,
    });
    await expect(assessReliabilityV2MigrationPreflight({
      markers: productionV1Fixture.marker,
      sqliteMaster: liveRows,
      contracts: [],
    })).resolves.toMatchObject({
      ready: false, state: "blocked", reason: "schema_v2_target_not_reconciled_with_live_v1",
    });
    await expect(assertReliabilityV2MigrationPreflight(liveDb))
      .rejects.toThrow(/schema_v2_target_not_reconciled_with_live_v1/);

    installLocalCandidate(raw);
    const localV2Rows = sqliteMasterRows(raw);
    const localV2 = await assessReliabilityStructure(localV2Rows, RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE);
    expect(localV2).toMatchObject({ proven: true, digest: declaredStructureDigest() });
    expect(localV2.objects).toEqual(EXPECTED_OBJECTS);
    expect(localV2.objects).toHaveLength(69);

    const v1Keys = new Set(RELIABILITY_SCHEMA_V1.expectedObjects);
    const prospectiveRows = [
      ...liveRows,
      ...structureProjection(raw)
        .filter((row) => !v1Keys.has(`${row.type}:${row.name}`))
        .map((row) => ({ type: row.type, name: row.name, tbl_name: row.table, sql: row.sql })),
    ];
    const prospective = await assessReliabilityStructure(
      prospectiveRows, RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE,
    );
    expect(prospective).toMatchObject({
      proven: false,
      digest: PROSPECTIVE_LIVE_V2_DIGEST,
      expectedDigest: "b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6",
    });
    expect(prospective.objects).toHaveLength(69);
    await expect(readReliabilitySchemaAuthority(d1FromSqlite(raw, {
      sqliteMasterRows: prospectiveRows, schemaMarkers: productionV1Fixture.marker,
    })))
      .resolves.toMatchObject({
        proven: false, reason: "schema_v2_target_not_reconciled_with_live_v1", version: 1,
      });
  });

  it("retains local two-file candidate evidence without treating it as production authority", async () => {
    const db = database();
    insertAcceptedLifecycle(db, { retentionUntil: 1_000 });
    installLocalCandidate(db);
    expect(db.prepare("SELECT MAX(version) version FROM reliability_schema_versions").get()).toEqual({ version: 1 });
    expect(db.prepare("SELECT COUNT(*) count FROM reliability_schema_contracts").get()).toEqual({ count: 0 });
    expect(structureDigest(db)).toBe(declaredStructureDigest());
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='reliability_v2_install_gate'").get()).toBeUndefined();
    applyFileTransaction(db, candidate);
    promoteLocalCandidate(db);
    const firstApplied = db.prepare(`SELECT v.applied_at version_applied_at, c.applied_at contract_applied_at
      FROM reliability_schema_versions v JOIN reliability_schema_contracts c ON c.version=v.version WHERE v.version=2`).get();
    applyFileTransaction(db, promotion);
    expect(db.prepare("SELECT state FROM source_events WHERE source_event_id='source-1'").get()).toEqual({ state: "accepted" });
    expect(db.prepare("SELECT structure_sha256 FROM reliability_schema_contracts WHERE version=2").get())
      .toEqual({ structure_sha256: declaredStructureDigest() });
    const applied = db.prepare(`SELECT v.applied_at version_applied_at, c.applied_at contract_applied_at
      FROM reliability_schema_versions v JOIN reliability_schema_contracts c ON c.version=v.version WHERE v.version=2`).get();
    expect(applied).toEqual(firstApplied);
    expect(applied.version_applied_at).toBe(applied.contract_applied_at);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='reliability_v2_promotion_gate'").get()).toBeUndefined();
    await expect(readReliabilitySchemaAuthority(d1FromSqlite(db))).resolves.toMatchObject({
      proven: false, reason: "schema_v2_authority_not_defined", version: 2,
    });
    await expect(assertReliabilityV2Postflight(d1FromSqlite(db)))
      .rejects.toThrow(/schema_v2_authority_not_defined/);
  });

  it("rolls local candidate files back on interruption and their SQL guards reject conflicting states", async () => {
    const interrupted = database();
    const broken = candidate.replace("CREATE TABLE IF NOT EXISTS automation_deployment_attestations", "THIS FAILS;\nCREATE TABLE IF NOT EXISTS automation_deployment_attestations");
    expect(() => applyFileTransaction(interrupted, broken)).toThrow();
    expect(interrupted.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get()).toBeUndefined();
    expect(interrupted.prepare("SELECT name FROM sqlite_master WHERE name='reliability_v2_install_gate'").get()).toBeUndefined();
    applyLocalCandidate(interrupted);

    const interruptedPromotion = database();
    installLocalCandidate(interruptedPromotion);
    const brokenPromotion = promotion.replace(
      "DROP TABLE reliability_v2_promotion_gate;",
      "THIS FAILS;\nDROP TABLE reliability_v2_promotion_gate;",
    );
    expect(() => applyFileTransaction(interruptedPromotion, brokenPromotion)).toThrow();
    expect(interruptedPromotion.prepare("SELECT COUNT(*) count FROM reliability_schema_contracts").get()).toEqual({ count: 0 });
    expect(interruptedPromotion.prepare("SELECT MAX(version) version FROM reliability_schema_versions").get()).toEqual({ version: 1 });
    expect(interruptedPromotion.prepare("SELECT name FROM sqlite_master WHERE name='reliability_v2_promotion_gate'").get()).toBeUndefined();
    expect(() => promoteLocalCandidate(interruptedPromotion)).not.toThrow();

    const conflict = database();
    conflict.prepare("INSERT INTO reliability_schema_versions VALUES (2,0,'wrong','wrong')").run();
    expect(() => installLocalCandidate(conflict)).toThrow(/CHECK constraint failed/);

    const partial = database();
    partial.exec("CREATE TABLE automation_release_manifests (wrong TEXT)");
    expect(() => installLocalCandidate(partial)).toThrow(/CHECK constraint failed/);

    const conflictingContract = database();
    installLocalCandidate(conflictingContract);
    conflictingContract.prepare(`INSERT INTO reliability_schema_contracts
      (version,migration_id,canonicalization,structure_sha256,expected_objects_json,applied_at)
      VALUES (2,'wrong','sqlite-master-required-closure.v1',?,'[]',1)`).run(hex("a"));
    expect(() => applyFileTransaction(conflictingContract, promotion)).toThrow(/CHECK constraint failed/);
    expect(conflictingContract.prepare("SELECT migration_id FROM reliability_schema_contracts WHERE version=2").get())
      .toEqual({ migration_id: "wrong" });
    await expect(readReliabilitySchemaAuthority(d1FromSqlite(conflictingContract)))
      .resolves.toMatchObject({ proven: false, reason: "schema_v1_marker_mismatch" });

    const extraBehavior = database();
    applyLocalCandidate(extraBehavior);
    extraBehavior.exec("CREATE TRIGGER unexpected_source_behavior BEFORE INSERT ON source_events BEGIN SELECT 1; END");
    await expect(assessReliabilityStructure(
      sqliteMasterRows(extraBehavior), RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE,
    )).resolves.toMatchObject({ proven: false });

    const future = database();
    future.prepare("INSERT INTO reliability_schema_versions VALUES (3,1,'future','future')").run();
    await expect(readReliabilitySchemaAuthority(d1FromSqlite(future)))
      .resolves.toMatchObject({ proven: false, reason: "schema_version_unknown", version: 3 });
  });

  it("allows generic future release manifests, renewed attestations, and dedupes the exact payload digest", async () => {
    const db = database();
    applyLocalCandidate(db);
    const release = insertRelease(db, { workflowVersion: 4, schemaVersion: 3, schemaStructure: hex("b") });
    expect(release.workflowVersion).toBe(4);

    const v3release = insertRelease(db, { id: `relm_${hex("c")}`, digest: hex("c") });
    insertAttestation(db, v3release);
    insertAttestation(db, v3release, {
      id: `depatt_${hex("d")}`, payload: hex("d"), observedAt: v3release.createdAt + 3_000,
      attestedAt: v3release.createdAt + 4_000, recordedAt: v3release.createdAt + 4_100,
      expiresAt: v3release.createdAt + 14_000,
    });
    expect(db.prepare("SELECT count(*) count FROM automation_deployment_attestations").get()).toEqual({ count: 2 });
    expect(() => insertAttestation(db, v3release, { id: `depatt_${hex("e")}` })).toThrow(/UNIQUE/);
  });

  it("rejects malformed authority rows and cross-release deployment mismatches at the database boundary", async () => {
    const db = database();
    applyLocalCandidate(db);
    const release = insertRelease(db);
    expect(() => insertAttestation(db, release, { signature: "bad" })).toThrow(/CHECK constraint failed/);
    expect(() => insertAttestation(db, release, { id: `depatt_${hex("d")}`, payload: hex("d"), expiresAt: release.createdAt + 1_500 })).toThrow(/CHECK constraint failed/);
    expect(() => insertAttestation(db, { ...release, workflowDocument: hex("b") }, { id: `depatt_${hex("e")}`, payload: hex("e") }))
      .toThrow(/does not match release/);
  });

  it("requires accepted source/lifecycle/version/window cross-links before provenance can exist", async () => {
    const db = database();
    applyLocalCandidate(db);
    const release = insertRelease(db);
    const attestation = insertAttestation(db, release);
    const lifecycle = insertAcceptedLifecycle(db, { retentionUntil: release.retentionUntil });
    const insert = (patch = {}) => {
      const value = {
        sourceId: lifecycle.sourceId, lifecycleId: lifecycle.lifecycleId, invocationId: "invocation-1",
        attestationId: attestation.id, runtimeVersion: attestation.versionId,
        workflowDocument: release.workflowDocument, schemaStructure: release.schemaStructure,
        boundAt: attestation.attestedAt + 1, retentionUntil: release.retentionUntil, ...patch,
      };
      return db.prepare(`INSERT INTO source_event_runtime_provenance
        (source_event_id,lifecycle_instance_id,invocation_id,deployment_attestation_id,cloudflare_version_id,
         workflow_document_sha256_at_bind,schema_structure_sha256_at_bind,follow_up_delivery_release_at_bind,
         follow_up_assigned_user_delivery_at_bind,bound_at,retention_until)
        VALUES (?,?,?,?,?,?,?,'approved','approved',?,?)`).run(value.sourceId, value.lifecycleId, value.invocationId, value.attestationId,
        value.runtimeVersion, value.workflowDocument, value.schemaStructure, value.boundAt, value.retentionUntil);
    };
    expect(() => insert({ boundAt: attestation.expiresAt })).toThrow(/stale authorities/);
    expect(() => insert({ workflowDocument: hex("b") })).toThrow(/stale authorities/);
    expect(() => insert({ schemaStructure: hex("c") })).toThrow(/stale authorities/);
    const wrongRuntime = insertAcceptedLifecycle(db, {
      sourceId: "source-runtime", lifecycleId: "lifecycle-runtime", runtimeVersion: "other-runtime",
      retentionUntil: release.retentionUntil,
    });
    expect(() => insert({
      sourceId: wrongRuntime.sourceId, lifecycleId: wrongRuntime.lifecycleId, invocationId: "invocation-runtime",
    })).toThrow(/stale authorities/);
    insert();
    expect(() => insert({ sourceId: "other", invocationId: "invocation-2" })).toThrow();
    expect(() => db.prepare("UPDATE source_event_runtime_provenance SET cloudflare_version_id='other'").run()).toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM reliability_schema_contracts WHERE version=2").run()).toThrow(/immutable/);
  });

  it("keeps both blocked SQL candidates absent from deployed schema, Wrangler registration, and runtime imports", () => {
    const db = database();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get()).toBeUndefined();
    expect(base).not.toContain(MIGRATION_ID);
    expect(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).not.toContain("reliability-spine-v2.local.sql");
    expect(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).not.toContain("reliability-spine-v2-promote.local.sql");
    expect(readFileSync(new URL("../package.json", import.meta.url), "utf8")).not.toMatch(/reliability-spine-v2(?:-promote)?\.local\.sql/);
    expect(candidate).toMatch(/^-- DO NOT APPLY\./);
    expect(promotion).toMatch(/^-- DO NOT APPLY\./);
    expect(candidate).not.toMatch(/wrangler[^\n]*--remote/i);
    expect(promotion).not.toMatch(/wrangler[^\n]*--remote/i);
    expect(candidate).not.toMatch(/INSERT\s+INTO\s+reliability_schema_versions\s*\([^)]*\)\s*(?:VALUES|SELECT)/i);
    expect(promotion.trim()).toMatch(/INSERT INTO reliability_schema_versions[\s\S]+;$/);
    expect(promotion.slice(promotion.lastIndexOf("INSERT INTO reliability_schema_versions")))
      .not.toMatch(/;\s*(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|WITH|SELECT)\b/i);
    const productionFiles = [
      ...productionJavaScriptFiles(fileURLToPath(new URL("../../functions", import.meta.url))),
      ...productionJavaScriptFiles(fileURLToPath(new URL("./", import.meta.url))),
    ].filter((path) => !path.endsWith("automation-truth-phase-d.js")
      && !path.endsWith("reliability-deployment-attestation-store.js"));
    for (const path of productionFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/automation-truth-phase-d|reliability-deployment-attestation-store|reliability-spine-v2(?:-promote)?\.local\.sql/);
    }
    expect(readFileSync(new URL("../../functions/lib/reliability-store.js", import.meta.url), "utf8"))
      .toMatch(/from "\.\/reliability-schema-authority\.js"/);
  });

  it("fails closed on every local-candidate v2 marker and on unknown future versions", async () => {
    const raw = database();
    applyLocalCandidate(raw);
    const db = d1FromSqlite(raw);
    const nowMs = Date.now();
    insertFreshCoverage(raw, nowMs);
    await expect(readReliabilityHealth(db, {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven",
      schemaReason: "schema_v2_authority_not_defined", schemaVersion: 2,
    });
    await expect(readReliabilitySchemaAuthority(db)).resolves.toMatchObject({
      proven: false, reason: "schema_v2_authority_not_defined", version: 2,
    });

    raw.exec("CREATE TRIGGER unexpected_source_behavior BEFORE INSERT ON source_events BEGIN SELECT 1; END");
    await expect(readReliabilityHealth(db, {
      family: "follow-up-session-reminders", nowMs: Date.now(), maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven", schemaReason: "schema_v2_authority_not_defined", schemaVersion: 2,
    });

    const markerOnly = database();
    installLocalCandidate(markerOnly);
    markerOnly.prepare(`INSERT INTO reliability_schema_versions VALUES
      (2,1,?,?)`).run(MIGRATION_ID, MIGRATION_DESCRIPTION);
    await expect(readReliabilityHealth(d1FromSqlite(markerOnly), {
      family: "follow-up-session-reminders", nowMs: Date.now(), maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven", schemaReason: "schema_v2_authority_not_defined", schemaVersion: 2,
    });

    const future = database();
    future.prepare("INSERT INTO reliability_schema_versions VALUES (3,1,'future','future')").run();
    await expect(readReliabilityHealth(d1FromSqlite(future), {
      family: "follow-up-session-reminders", nowMs: Date.now(), maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "schema_unproven", schemaReason: "schema_version_unknown", schemaVersion: 3,
    });
  });
});
