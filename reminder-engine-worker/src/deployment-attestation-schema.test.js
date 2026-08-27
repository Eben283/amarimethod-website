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
  RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
  assessReliabilityStructure,
  assessReliabilityV2InstallCandidatePreflight,
  assessReliabilityV2MigrationPreflight,
  assessReliabilityV2PromotionCandidatePreflight,
  assertReliabilityV2MigrationPreflight,
  assertReliabilityV2Postflight,
  reliabilityStructureProjection,
  readReliabilitySchemaAuthority,
} from "../../functions/lib/reliability-schema-authority.js";
import { readReliabilityHealth } from "../../functions/lib/reliability-store.js";

const base = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const candidate = readFileSync(new URL("../reliability-spine-v2.local.sql", import.meta.url), "utf8");
const promotion = readFileSync(new URL("../reliability-spine-v2-promote.local.sql", import.meta.url), "utf8");
const liveLineageInstall = readFileSync(new URL(
  "../reliability-spine-v2-production-lineage-install.local.sql",
  import.meta.url,
), "utf8");
const liveLineageRollback = readFileSync(new URL(
  "../reliability-spine-v2-production-lineage-rollback.local.sql",
  import.meta.url,
), "utf8");
const liveLineagePromotionTemplate = readFileSync(new URL(
  "../reliability-spine-v2-production-lineage-promote.template.sql",
  import.meta.url,
), "utf8");
const productionV1FixtureSource = readFileSync(new URL(
  "../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json",
  import.meta.url,
), "utf8");
const productionV1Fixture = JSON.parse(productionV1FixtureSource);
const productionV2CandidateFixture = JSON.parse(readFileSync(new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-candidate.v1.json",
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

function productionV1Database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const type of ["table", "index", "trigger"]) {
    for (const row of productionV1Fixture.projection.filter((item) => item.type === type)) db.exec(row.sql);
  }
  const marker = productionV1Fixture.marker[0];
  db.prepare(`INSERT INTO reliability_schema_versions
    (version,applied_at,migration_id,description) VALUES (?,?,?,?)`).run(
    marker.version,
    marker.applied_at,
    marker.migration_id,
    marker.description,
  );
  return db;
}

function setExactProductionV1Marker(db) {
  const marker = productionV1Fixture.marker[0];
  db.prepare(`UPDATE reliability_schema_versions SET
    applied_at=?,migration_id=?,description=? WHERE version=1`).run(
    marker.applied_at,
    marker.migration_id,
    marker.description,
  );
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

function installLiveLineageCandidate(db) {
  applyFileTransaction(db, liveLineageInstall);
}

function rollbackLiveLineageCandidate(db) {
  applyFileTransaction(db, liveLineageRollback);
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

  it("proves the exact live-lineage candidate while keeping install and promotion unauthorized", async () => {
    const raw = database();
    const liveRows = productionV1Rows();
    const liveDb = d1FromSqlite(raw, {
      sqliteMasterRows: liveRows, schemaMarkers: productionV1Fixture.marker,
    });
    const exactInput = {
      markers: productionV1Fixture.marker,
      sqliteMaster: liveRows,
      contracts: [],
    };
    await expect(assessReliabilityV2InstallCandidatePreflight(exactInput)).resolves.toMatchObject({
      candidateCompatible: true,
      authorized: false,
      state: "exact_live_v1_candidate_input",
      reason: "schema_v2_install_requires_separate_authorization",
      target: {
        variantId: "production-live-lineage-v2-8c7245a",
        structureSha256: PROSPECTIVE_LIVE_V2_DIGEST,
      },
    });
    await expect(assessReliabilityV2MigrationPreflight(exactInput)).resolves.toMatchObject({
      ready: false, state: "blocked", reason: "schema_v2_source_only_not_authorized",
      candidate: { candidateCompatible: true, authorized: false },
    });
    await expect(assertReliabilityV2MigrationPreflight(liveDb))
      .rejects.toThrow(/schema_v2_source_only_not_authorized/);

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
    await expect(assessReliabilityStructure(
      prospectiveRows, RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    )).resolves.toMatchObject({ proven: true, digest: PROSPECTIVE_LIVE_V2_DIGEST });
    await expect(readReliabilitySchemaAuthority(d1FromSqlite(raw, {
      sqliteMasterRows: prospectiveRows, schemaMarkers: productionV1Fixture.marker,
    })))
      .resolves.toMatchObject({
        proven: false, reason: "schema_v2_physical_install_awaiting_promotion", version: 1,
        migrationState: "installed_awaiting_promotion",
      });
    await expect(assessReliabilityV2PromotionCandidatePreflight({
      markers: productionV1Fixture.marker,
      sqliteMaster: prospectiveRows,
      contracts: [],
      additiveTableCounts: {
        automation_deployment_attestations: 0,
        automation_release_manifests: 0,
        reliability_schema_contracts: 0,
        source_event_runtime_provenance: 0,
      },
    })).resolves.toMatchObject({
      candidateCompatible: true,
      additiveTablesEmpty: true,
      authorized: false,
      state: "predicted_shape_requires_primary_readback",
      reason: "schema_v2_primary_readback_required",
    });
  });

  it("pins the exact 49 plus 20 projection and executes Phase A without promoting authority", async () => {
    expect(createHash("sha256").update(productionV1FixtureSource).digest("hex"))
      .toBe(productionV2CandidateFixture.baseFixtureSha256);
    expect(productionV2CandidateFixture).toMatchObject({
      status: "candidate-only-not-observed",
      authority: false,
      remoteObserved: false,
      variantId: RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.variantId,
      candidateMigrationId: RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId,
      finalMigrationId: null,
      baseVariantId: RELIABILITY_SCHEMA_V1.variantId,
      objectCount: 69,
      additiveObjectCount: 20,
      structureSha256: PROSPECTIVE_LIVE_V2_DIGEST,
      matchesCleanBootstrapV2: false,
    });
    expect(productionV2CandidateFixture.structureSha256)
      .not.toBe(RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.structureSha256);
    expect(RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId)
      .not.toBe(RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.migrationId);
    expect(productionV2CandidateFixture.expectedObjects)
      .toEqual(RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.expectedObjects);
    expect(productionV2CandidateFixture.projection.map((row) => `${row.type}:${row.name}`))
      .toEqual(productionV2CandidateFixture.expectedObjects);
    expect(createHash("sha256").update(JSON.stringify(productionV2CandidateFixture.projection)).digest("hex"))
      .toBe(PROSPECTIVE_LIVE_V2_DIGEST);
    expect(productionV2CandidateFixture.additiveObjects).toHaveLength(20);
    const additiveProjection = productionV2CandidateFixture.projection.filter(
      (row) => productionV2CandidateFixture.additiveObjects.includes(`${row.type}:${row.name}`),
    );
    expect(createHash("sha256").update(JSON.stringify(additiveProjection)).digest("hex"))
      .toBe(productionV2CandidateFixture.sourceProvenance.additiveProjectionSha256);
    expect(createHash("sha256").update(candidate).digest("hex"))
      .toBe(productionV2CandidateFixture.sourceProvenance.additiveDdlSourceSha256);

    const db = productionV1Database();
    db.exec(`CREATE TABLE unrelated_application_table (id TEXT PRIMARY KEY);
      CREATE INDEX unrelated_application_index ON unrelated_application_table(id);
      CREATE TRIGGER unrelated_application_trigger BEFORE INSERT ON unrelated_application_table BEGIN SELECT 1; END;`);
    insertAcceptedLifecycle(db, { sourceId: "source-preserved", lifecycleId: "lifecycle-preserved" });
    const before = db.prepare("SELECT state FROM source_events WHERE source_event_id='source-preserved'").get();
    installLiveLineageCandidate(db);

    const projection = reliabilityStructureProjection(
      sqliteMasterRows(db), RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    );
    expect(projection).toEqual(productionV2CandidateFixture.projection);
    expect(await assessReliabilityStructure(
      sqliteMasterRows(db), RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    )).toMatchObject({ proven: true, digest: PROSPECTIVE_LIVE_V2_DIGEST });
    expect(db.prepare("SELECT * FROM reliability_schema_versions ORDER BY version").all())
      .toEqual(productionV1Fixture.marker);
    expect(db.prepare("SELECT COUNT(*) count FROM reliability_schema_contracts").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT state FROM source_events WHERE source_event_id='source-preserved'").get()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='unrelated_application_trigger'").get())
      .toBeDefined();

    const firstProjection = JSON.stringify(projection);
    installLiveLineageCandidate(db);
    expect(JSON.stringify(reliabilityStructureProjection(
      sqliteMasterRows(db), RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    ))).toBe(firstProjection);

    const nowMs = Date.now();
    insertFreshCoverage(db, nowMs);
    await expect(readReliabilityHealth(d1FromSqlite(db), {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded",
      reason: "schema_unproven",
      schemaReason: "schema_v2_physical_install_awaiting_promotion",
      schemaVersion: 1,
    });
  });

  it("rolls Phase A back only from an exact empty candidate and preserves v1 rows", async () => {
    const db = productionV1Database();
    insertAcceptedLifecycle(db, { sourceId: "source-rollback", lifecycleId: "lifecycle-rollback" });
    const preserved = db.prepare("SELECT * FROM source_events WHERE source_event_id='source-rollback'").get();
    installLiveLineageCandidate(db);
    rollbackLiveLineageCandidate(db);

    const v1 = await assessReliabilityStructure(sqliteMasterRows(db), RELIABILITY_SCHEMA_V1);
    expect(v1).toMatchObject({ proven: true, digest: RELIABILITY_SCHEMA_V1.structureSha256 });
    expect(db.prepare("SELECT * FROM reliability_schema_versions ORDER BY version").all())
      .toEqual(productionV1Fixture.marker);
    expect(db.prepare("SELECT * FROM source_events WHERE source_event_id='source-rollback'").get()).toEqual(preserved);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get())
      .toBeUndefined();

    installLiveLineageCandidate(db);
    db.prepare(`INSERT INTO automation_release_manifests
      (release_manifest_id,release_manifest_digest,family,source_repository,source_revision,source_tree,
       worker_version,runtime_version,lockfile_sha256,bundle_sha256,modules_digest,compiler_id,
       compiler_artifact_sha256,spec_digest,compiled_plan_digest,handler_registry_digest,message_catalog_digest,
       expected_bindings_digest,workflow_id,workflow_version,workflow_state,workflow_document_sha256,
       schema_database_id,schema_migration_id,schema_version,schema_source_sha256,schema_structure_sha256,
       follow_up_delivery_release,follow_up_assigned_user_delivery,declared_effect_owner,canonical_json,
       created_at,retention_until)
      VALUES ('rollback-block','${"a".repeat(64)}','follow-up-session-reminders','repo','${"b".repeat(40)}',
        '${"c".repeat(40)}','worker','runtime','${"d".repeat(64)}','${"e".repeat(64)}','${"f".repeat(64)}',
        'compiler','${"1".repeat(64)}','${"2".repeat(64)}','${"3".repeat(64)}','${"4".repeat(64)}',
        '${"5".repeat(64)}','${"6".repeat(64)}','workflow',1,'published','${"7".repeat(64)}','db',
        'reliability-spine-v2-deployment-attestation',2,'${"8".repeat(64)}','${"9".repeat(64)}',
        'approved','approved','Amari','{}',1,2)`).run();
    expect(() => rollbackLiveLineageCandidate(db)).toThrow(/CHECK constraint failed/);
    expect(db.prepare("SELECT release_manifest_id FROM automation_release_manifests").get())
      .toEqual({ release_manifest_id: "rollback-block" });
  });

  it("rolls back interrupted candidate files and rejects marker, lineage, partial, wrong-DDL, and extra behavior", async () => {
    const interrupted = productionV1Database();
    const brokenInstall = liveLineageInstall.replace(
      "CREATE TABLE IF NOT EXISTS automation_deployment_attestations",
      "THIS FAILS;\nCREATE TABLE IF NOT EXISTS automation_deployment_attestations",
    );
    expect(() => applyFileTransaction(interrupted, brokenInstall)).toThrow();
    expect(interrupted.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get())
      .toBeUndefined();
    expect(interrupted.prepare("SELECT name FROM sqlite_master WHERE name='reliability_v2_live_lineage_install_gate'").get())
      .toBeUndefined();

    const wrongMarker = productionV1Database();
    wrongMarker.prepare("UPDATE reliability_schema_versions SET applied_at=1").run();
    expect(() => installLiveLineageCandidate(wrongMarker)).toThrow(/CHECK constraint failed/);

    const cleanBootstrap = database();
    setExactProductionV1Marker(cleanBootstrap);
    expect(() => installLiveLineageCandidate(cleanBootstrap)).toThrow(/CHECK constraint failed/);
    expect(cleanBootstrap.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get())
      .toBeUndefined();

    const partial = productionV1Database();
    partial.exec("CREATE TABLE automation_release_manifests (wrong TEXT)");
    expect(() => installLiveLineageCandidate(partial)).toThrow(/CHECK constraint failed/);
    expect(partial.prepare("SELECT sql FROM sqlite_master WHERE name='automation_release_manifests'").get().sql)
      .toBe("CREATE TABLE automation_release_manifests (wrong TEXT)");

    const partialNineteen = productionV1Database();
    installLiveLineageCandidate(partialNineteen);
    partialNineteen.exec("DROP TRIGGER source_event_runtime_provenance_no_update");
    expect(() => installLiveLineageCandidate(partialNineteen)).toThrow(/CHECK constraint failed/);

    const cleanBootstrapV2 = database();
    setExactProductionV1Marker(cleanBootstrapV2);
    installLocalCandidate(cleanBootstrapV2);
    expect(structureDigest(cleanBootstrapV2)).toBe(RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.structureSha256);
    expect(() => installLiveLineageCandidate(cleanBootstrapV2)).toThrow(/CHECK constraint failed/);

    const wrongDdl = productionV1Database();
    installLiveLineageCandidate(wrongDdl);
    wrongDdl.exec(`DROP INDEX idx_deployment_attestations_latest;
      CREATE INDEX idx_deployment_attestations_latest ON automation_deployment_attestations
        (platform, service, environment, deployment_id, version_id, attested_at DESC);`);
    expect(() => installLiveLineageCandidate(wrongDdl)).toThrow(/CHECK constraint failed/);
    await expect(assessReliabilityStructure(
      sqliteMasterRows(wrongDdl), RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    )).resolves.toMatchObject({ proven: false });

    const extraRequiredBehavior = productionV1Database();
    extraRequiredBehavior.exec(`CREATE TRIGGER unexpected_source_behavior
      BEFORE INSERT ON source_events BEGIN SELECT 1; END`);
    expect(() => installLiveLineageCandidate(extraRequiredBehavior)).toThrow(/CHECK constraint failed/);
    expect(extraRequiredBehavior.prepare("SELECT name FROM sqlite_master WHERE name='unexpected_source_behavior'").get())
      .toBeDefined();

    const interruptedRollback = productionV1Database();
    installLiveLineageCandidate(interruptedRollback);
    const brokenRollback = liveLineageRollback.replace(
      "DROP TABLE automation_deployment_attestations;",
      "THIS FAILS;\nDROP TABLE automation_deployment_attestations;",
    );
    expect(() => applyFileTransaction(interruptedRollback, brokenRollback)).toThrow();
    await expect(assessReliabilityStructure(
      sqliteMasterRows(interruptedRollback), RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    )).resolves.toMatchObject({ proven: true, digest: PROSPECTIVE_LIVE_V2_DIGEST });
    expect(interruptedRollback.prepare("SELECT name FROM sqlite_master WHERE name='reliability_v2_live_lineage_rollback_gate'").get())
      .toBeUndefined();
  });

  it("keeps Phase B non-executable until primary readback and fails closed on a predicted v2 marker", async () => {
    expect(liveLineagePromotionTemplate).toMatch(/^-- NOT EXECUTABLE\./);
    expect(liveLineagePromotionTemplate).toContain("PHASE_B_TEMPLATE_BLOCKED_UNTIL_EXACT_PRIMARY_D1_PHASE_A_READBACK_IS_CHECKED_IN");
    expect(liveLineagePromotionTemplate).not.toMatch(/INSERT\s+INTO\s+reliability_schema_(?:contracts|versions)/i);
    expect(() => new DatabaseSync(":memory:").exec(liveLineagePromotionTemplate)).toThrow();

    const staged = productionV1Database();
    installLiveLineageCandidate(staged);
    await expect(assessReliabilityV2PromotionCandidatePreflight({
      markers: productionV1Fixture.marker,
      sqliteMaster: sqliteMasterRows(staged),
      contracts: [],
    })).resolves.toMatchObject({
      candidateCompatible: false,
      structureCompatible: true,
      additiveTablesEmpty: false,
      authorized: false,
      reason: "schema_v2_additive_table_emptiness_unproven",
    });
    for (const invalidCount of [null, false, "0", 1]) {
      await expect(assessReliabilityV2PromotionCandidatePreflight({
        markers: productionV1Fixture.marker,
        sqliteMaster: sqliteMasterRows(staged),
        contracts: [],
        additiveTableCounts: {
          automation_deployment_attestations: invalidCount,
          automation_release_manifests: 0,
          reliability_schema_contracts: 0,
          source_event_runtime_provenance: 0,
        },
      })).resolves.toMatchObject({
        candidateCompatible: false,
        authorized: false,
        reason: "schema_v2_additive_table_emptiness_unproven",
      });
    }

    const appliedAt = 1787720000000;
    staged.prepare(`INSERT INTO reliability_schema_contracts
      (version,migration_id,canonicalization,structure_sha256,expected_objects_json,applied_at)
      VALUES (2,?,?,?,?,?)`).run(
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.canonicalization,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.structureSha256,
      JSON.stringify(RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.expectedObjects),
      appliedAt,
    );
    staged.prepare(`INSERT INTO reliability_schema_versions
      (version,applied_at,migration_id,description) VALUES (2,?,?,?)`).run(
      appliedAt,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.description,
    );
    const nowMs = Date.now();
    insertFreshCoverage(staged, nowMs);
    await expect(readReliabilityHealth(d1FromSqlite(staged), {
      family: "follow-up-session-reminders", nowMs, maxAgeMs: 60_000,
    })).resolves.toMatchObject({
      truth: "Degraded",
      reason: "schema_unproven",
      schemaReason: "schema_v2_authority_not_defined",
      schemaVersion: 2,
    });
  });

  it("rejects install replay and rollback after a contract or v2 marker exists", () => {
    const withContract = productionV1Database();
    installLiveLineageCandidate(withContract);
    withContract.prepare(`INSERT INTO reliability_schema_contracts
      (version,migration_id,canonicalization,structure_sha256,expected_objects_json,applied_at)
      VALUES (2,?,?,?,?,?)`).run(
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.canonicalization,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.structureSha256,
      JSON.stringify(RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.expectedObjects),
      1787720000000,
    );
    expect(() => installLiveLineageCandidate(withContract)).toThrow(/CHECK constraint failed/);
    expect(() => rollbackLiveLineageCandidate(withContract)).toThrow(/CHECK constraint failed/);
    expect(withContract.prepare("SELECT COUNT(*) count FROM reliability_schema_contracts").get())
      .toEqual({ count: 1 });

    const withMarker = productionV1Database();
    installLiveLineageCandidate(withMarker);
    withMarker.prepare(`INSERT INTO reliability_schema_versions
      (version,applied_at,migration_id,description) VALUES (2,?,?,?)`).run(
      1787720000000,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.description,
    );
    expect(() => installLiveLineageCandidate(withMarker)).toThrow(/CHECK constraint failed/);
    expect(() => rollbackLiveLineageCandidate(withMarker)).toThrow(/CHECK constraint failed/);
    expect(withMarker.prepare("SELECT MAX(version) version FROM reliability_schema_versions").get())
      .toEqual({ version: 2 });

    const restored = productionV1Database();
    installLiveLineageCandidate(restored);
    rollbackLiveLineageCandidate(restored);
    expect(() => rollbackLiveLineageCandidate(restored)).toThrow(/CHECK constraint failed/);
    expect(restored.prepare("SELECT * FROM reliability_schema_versions").all())
      .toEqual(productionV1Fixture.marker);
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

  it("keeps every source-only artifact absent from deployed schema, Wrangler registration, and runtime imports", () => {
    const db = database();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get()).toBeUndefined();
    expect(base).not.toContain(MIGRATION_ID);
    expect(base).not.toContain("reliability-spine-v2-production-lineage");
    expect(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).not.toContain("reliability-spine-v2.local.sql");
    expect(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).not.toContain("reliability-spine-v2-promote.local.sql");
    expect(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).not.toContain("reliability-spine-v2-production-lineage");
    expect(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
      .not.toMatch(/reliability-spine-v2(?:-promote)?\.local\.sql|reliability-spine-v2-production-lineage/);
    expect(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
      .not.toMatch(/reliability-spine-v2(?:-promote)?\.local\.sql|reliability-spine-v2-production-lineage/);
    expect(candidate).toMatch(/^-- DO NOT APPLY\./);
    expect(promotion).toMatch(/^-- DO NOT APPLY\./);
    expect(liveLineageInstall).toMatch(/^-- DO NOT APPLY\./);
    expect(liveLineageRollback).toMatch(/^-- DO NOT APPLY\./);
    expect(liveLineagePromotionTemplate).toMatch(/^-- NOT EXECUTABLE\./);
    expect(candidate).not.toMatch(/wrangler[^\n]*--remote/i);
    expect(promotion).not.toMatch(/wrangler[^\n]*--remote/i);
    expect(liveLineageInstall).not.toMatch(/wrangler[^\n]*--remote/i);
    expect(liveLineageRollback).not.toMatch(/wrangler[^\n]*--remote/i);
    expect(liveLineagePromotionTemplate).not.toMatch(/wrangler[^\n]*--remote/i);
    expect(candidate).not.toMatch(/INSERT\s+INTO\s+reliability_schema_versions\s*\([^)]*\)\s*(?:VALUES|SELECT)/i);
    expect(liveLineageInstall).not.toMatch(/INSERT\s+INTO\s+reliability_schema_versions\s*\([^)]*\)\s*(?:VALUES|SELECT)/i);
    expect(liveLineageRollback).not.toMatch(/INSERT\s+INTO\s+reliability_schema_versions\s*\([^)]*\)\s*(?:VALUES|SELECT)/i);
    expect(liveLineagePromotionTemplate).not.toMatch(/INSERT\s+INTO\s+reliability_schema_(?:contracts|versions)/i);
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
      expect(source, path).not.toMatch(/automation-truth-phase-d|reliability-deployment-attestation-store|reliability-spine-v2(?:-promote)?\.local\.sql|reliability-spine-v2-production-lineage-(?:install|rollback)\.local\.sql|reliability-spine-v2-production-lineage-promote\.template\.sql/);
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
