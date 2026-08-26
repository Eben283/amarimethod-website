import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readReliabilityHealth } from "../../functions/lib/reliability-store.js";

const base = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const candidate = readFileSync(new URL("../reliability-spine-v2.local.sql", import.meta.url), "utf8");
const MIGRATION_ID = "reliability-spine-v2-deployment-attestation";
const MIGRATION_DESCRIPTION = "Authenticated release manifests, deployment attestations, and source-event runtime provenance";
const STRUCTURE_CANONICALIZATION = "sqlite-master-required-closure.v1";
const EXPECTED_OBJECTS = [
  "index:idx_command_obligation",
  "index:idx_deployment_attestations_latest",
  "index:idx_deployment_attestations_release",
  "index:idx_deployment_attestations_runtime_version",
  "index:idx_enr_contact",
  "index:idx_evidence_access",
  "index:idx_evt_contact",
  "index:idx_evt_engine_flow",
  "index:idx_evt_flow",
  "index:idx_exception_events",
  "index:idx_exceptions_family_queue",
  "index:idx_exceptions_queue",
  "index:idx_lease_events",
  "index:idx_lifecycle_appointment",
  "index:idx_lifecycle_family_state",
  "index:idx_lifecycle_person",
  "index:idx_obligations_due",
  "index:idx_obligations_lease",
  "index:idx_reconciliation_family",
  "index:idx_source_events_provider_event",
  "index:idx_source_events_received",
  "index:idx_source_runtime_provenance_deployment",
  "index:idx_source_transitions",
  "index:idx_steps_due",
  "index:idx_workflow_one_published",
  "table:automation_deployment_attestations",
  "table:automation_events",
  "table:automation_release_manifests",
  "table:command_attempts",
  "table:evidence_access_events",
  "table:exception_events",
  "table:lifecycle_exceptions",
  "table:lifecycle_instances",
  "table:lifecycle_obligations",
  "table:obligation_lease_events",
  "table:provider_receipts",
  "table:reconciliation_runs",
  "table:reliability_schema_contracts",
  "table:reliability_schema_versions",
  "table:reminder_enrollments",
  "table:reminder_steps",
  "table:source_event_runtime_provenance",
  "table:source_event_transitions",
  "table:source_events",
  "table:workflow_versions",
  "trigger:automation_deployment_attestations_consistent_insert",
  "trigger:automation_deployment_attestations_no_delete",
  "trigger:automation_deployment_attestations_no_overlap_conflict",
  "trigger:automation_deployment_attestations_no_update",
  "trigger:automation_deployment_attestations_no_version_identity_conflict",
  "trigger:automation_events_no_delete",
  "trigger:automation_events_no_update",
  "trigger:automation_release_manifests_no_delete",
  "trigger:automation_release_manifests_no_update",
  "trigger:evidence_access_no_delete",
  "trigger:evidence_access_no_update",
  "trigger:exception_events_no_delete",
  "trigger:exception_events_no_update",
  "trigger:lease_events_no_delete",
  "trigger:lease_events_no_update",
  "trigger:reliability_schema_contracts_no_delete",
  "trigger:reliability_schema_contracts_no_update",
  "trigger:source_event_runtime_provenance_consistent_insert",
  "trigger:source_event_runtime_provenance_no_delete",
  "trigger:source_event_runtime_provenance_no_update",
  "trigger:source_events_no_delete",
  "trigger:source_events_no_update",
  "trigger:source_transitions_no_delete",
  "trigger:source_transitions_no_update",
];

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

function structureDigest(db) {
  return createHash("sha256").update(JSON.stringify(structureProjection(db))).digest("hex");
}

function declaredStructureDigest() {
  const match = candidate.match(/VALUES \(2, 'reliability-spine-v2-deployment-attestation', 'sqlite-master-required-closure\.v1',\s*'([a-f0-9]{64})'/);
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

function preflight(db) {
  const marker = db.prepare("SELECT * FROM reliability_schema_versions WHERE version=2").get();
  if (marker && (marker.migration_id !== MIGRATION_ID || marker.description !== MIGRATION_DESCRIPTION)) {
    throw new Error("conflicting reliability schema v2 marker");
  }
  const hasContracts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reliability_schema_contracts'").get();
  const contract = hasContracts ? db.prepare("SELECT * FROM reliability_schema_contracts WHERE version=2").get() : null;
  if (contract && (contract.migration_id !== MIGRATION_ID
    || contract.canonicalization !== STRUCTURE_CANONICALIZATION
    || contract.structure_sha256 !== declaredStructureDigest()
    || contract.expected_objects_json !== JSON.stringify(EXPECTED_OBJECTS))) {
    throw new Error("conflicting reliability schema v2 structure contract");
  }
}

function applyCandidate(db) {
  preflight(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(candidate);
    const projection = structureProjection(db);
    if (JSON.stringify(projection.map((row) => `${row.type}:${row.name}`)) !== JSON.stringify(EXPECTED_OBJECTS)) {
      throw new Error("reliability schema v2 object catalog postflight mismatch");
    }
    if (structureDigest(db) !== declaredStructureDigest()) throw new Error("reliability schema v2 structure postflight mismatch");
    const marker = db.prepare("SELECT migration_id,description FROM reliability_schema_versions WHERE version=2").get();
    if (marker?.migration_id !== MIGRATION_ID || marker?.description !== MIGRATION_DESCRIPTION) throw new Error("reliability schema v2 marker postflight mismatch");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
  it("applies additively/idempotently, records its exact description, and verifies sqlite_master postflight", () => {
    const db = database();
    insertAcceptedLifecycle(db, { retentionUntil: 1_000 });
    applyCandidate(db);
    applyCandidate(db);
    expect(db.prepare("SELECT state FROM source_events WHERE source_event_id='source-1'").get()).toEqual({ state: "accepted" });
    expect(db.prepare("SELECT structure_sha256 FROM reliability_schema_contracts WHERE version=2").get())
      .toEqual({ structure_sha256: declaredStructureDigest() });
    const applied = db.prepare(`SELECT v.applied_at version_applied_at, c.applied_at contract_applied_at
      FROM reliability_schema_versions v JOIN reliability_schema_contracts c ON c.version=v.version WHERE v.version=2`).get();
    expect(applied.version_applied_at).toBeGreaterThan(0);
    expect(applied.contract_applied_at).toBeGreaterThan(0);
    expect(Math.abs(applied.version_applied_at - Date.now())).toBeLessThan(5_000);
    expect(Math.abs(applied.contract_applied_at - Date.now())).toBeLessThan(5_000);
  });

  it("rolls an interrupted migration back and rejects conflicting markers or partial schema", () => {
    const interrupted = database();
    const broken = candidate.replace("CREATE TABLE IF NOT EXISTS automation_deployment_attestations", "THIS FAILS;\nCREATE TABLE IF NOT EXISTS automation_deployment_attestations");
    interrupted.exec("BEGIN");
    expect(() => interrupted.exec(broken)).toThrow();
    interrupted.exec("ROLLBACK");
    expect(interrupted.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get()).toBeUndefined();
    applyCandidate(interrupted);

    const conflict = database();
    conflict.prepare("INSERT INTO reliability_schema_versions VALUES (2,0,'wrong','wrong')").run();
    expect(() => applyCandidate(conflict)).toThrow(/conflicting reliability schema v2 marker/);

    const partial = database();
    partial.exec("CREATE TABLE automation_release_manifests (wrong TEXT)");
    expect(() => applyCandidate(partial)).toThrow(/postflight mismatch/);

    const extraBehavior = database();
    applyCandidate(extraBehavior);
    extraBehavior.exec("CREATE TRIGGER unexpected_source_behavior BEFORE INSERT ON source_events BEGIN SELECT 1; END");
    expect(() => applyCandidate(extraBehavior)).toThrow(/object catalog postflight mismatch/);
  });

  it("allows generic future versions, renewed attestations, and dedupes the exact payload digest", () => {
    const db = database();
    applyCandidate(db);
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

  it("rejects malformed authority rows and cross-release deployment mismatches at the database boundary", () => {
    const db = database();
    applyCandidate(db);
    const release = insertRelease(db);
    expect(() => insertAttestation(db, release, { signature: "bad" })).toThrow(/CHECK constraint failed/);
    expect(() => insertAttestation(db, release, { id: `depatt_${hex("d")}`, payload: hex("d"), expiresAt: release.createdAt + 1_500 })).toThrow(/CHECK constraint failed/);
    expect(() => insertAttestation(db, { ...release, workflowDocument: hex("b") }, { id: `depatt_${hex("e")}`, payload: hex("e") }))
      .toThrow(/does not match release/);
  });

  it("requires accepted source/lifecycle/version/window cross-links before provenance can exist", () => {
    const db = database();
    applyCandidate(db);
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

  it("is absent from deployed schema, Wrangler migrations, and runtime imports", () => {
    const db = database();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='automation_release_manifests'").get()).toBeUndefined();
    expect(base).not.toContain(MIGRATION_ID);
    expect(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).not.toContain("reliability-spine-v2.local.sql");
    const productionFiles = [
      ...productionJavaScriptFiles(fileURLToPath(new URL("../../functions", import.meta.url))),
      ...productionJavaScriptFiles(fileURLToPath(new URL("./", import.meta.url))),
    ].filter((path) => !path.endsWith("automation-truth-phase-d.js")
      && !path.endsWith("reliability-deployment-attestation-store.js"));
    for (const path of productionFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/automation-truth-phase-d|reliability-deployment-attestation-store|reliability-spine-v2\.local\.sql/);
    }
  });

  it("keeps production adoption blocked until the v1-only health reader understands v2", async () => {
    const raw = database();
    applyCandidate(raw);
    const db = {
      prepare(sql) {
        return {
          values: [], bind(...values) { this.values = values; return this; },
          first() { return raw.prepare(sql).get(...this.values) || null; },
        };
      },
    };
    await expect(readReliabilityHealth(db, {
      family: "follow-up-session-reminders", nowMs: Date.now(), maxAgeMs: 60_000,
    })).resolves.toMatchObject({ truth: "Degraded", reason: "schema_unproven", schemaVersion: 2 });
  });
});
