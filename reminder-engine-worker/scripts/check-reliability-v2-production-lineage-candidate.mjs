import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  RELIABILITY_SCHEMA_V1,
  RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE,
  RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
  assessReliabilityStructure,
  reliabilityStructureProjection,
} from "../../functions/lib/reliability-schema-authority.js";

const baseFixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json",
  import.meta.url,
);
const candidateFixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-candidate.v1.json",
  import.meta.url,
);
const installUrl = new URL("../reliability-spine-v2-production-lineage-install.local.sql", import.meta.url);
const rollbackUrl = new URL("../reliability-spine-v2-production-lineage-rollback.local.sql", import.meta.url);
const additiveDdlUrl = new URL("../reliability-spine-v2.local.sql", import.meta.url);

const baseFixtureSource = readFileSync(baseFixtureUrl, "utf8");
const baseFixture = JSON.parse(baseFixtureSource);
const candidateFixture = JSON.parse(readFileSync(candidateFixtureUrl, "utf8"));
const installSql = readFileSync(installUrl, "utf8");
const rollbackSql = readFileSync(rollbackUrl, "utf8");
const additiveDdlSource = readFileSync(additiveDdlUrl, "utf8");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(`live-lineage v2 candidate check failed: ${message}`); };

if (sha256(baseFixtureSource) !== candidateFixture.baseFixtureSha256) fail("base fixture file hash drifted");
if (candidateFixture.authority !== false || candidateFixture.remoteObserved !== false) {
  fail("candidate fixture must remain non-authoritative and unobserved");
}
if (candidateFixture.structureSha256 === RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.structureSha256) {
  fail("production-lineage candidate was confused with clean-bootstrap b289");
}
if (candidateFixture.candidateMigrationId !== RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId
  || candidateFixture.candidateMigrationId === RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.migrationId
  || candidateFixture.finalMigrationId !== null) {
  fail("candidate migration identity is not distinct and explicitly non-final");
}
if (sha256(additiveDdlSource) !== candidateFixture.sourceProvenance.additiveDdlSourceSha256) {
  fail("reviewed additive DDL source hash drifted");
}

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
for (const type of ["table", "index", "trigger"]) {
  for (const row of baseFixture.projection.filter((item) => item.type === type)) db.exec(row.sql);
}
const marker = baseFixture.marker[0];
db.prepare(`INSERT INTO reliability_schema_versions
  (version,applied_at,migration_id,description) VALUES (?,?,?,?)`).run(
  marker.version,
  marker.applied_at,
  marker.migration_id,
  marker.description,
);

const beforeRows = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
  WHERE type IN ('table','index','trigger') ORDER BY type,name`).all();
const before = await assessReliabilityStructure(beforeRows, RELIABILITY_SCHEMA_V1);
if (!before.proven) fail(`base structure is not exact f7af (${before.digest})`);

// This local transaction simulates an officially transactional future D1
// application mechanism. It is not evidence that arbitrary Worker exec() is
// atomic and it performs no remote/provider operation.
db.exec("BEGIN IMMEDIATE");
try {
  db.exec(installSql);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const afterRows = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
  WHERE type IN ('table','index','trigger') ORDER BY type,name`).all();
const projection = reliabilityStructureProjection(
  afterRows,
  RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
);
const digest = sha256(JSON.stringify(projection));
const keys = projection.map((row) => `${row.type}:${row.name}`);
const v1Keys = new Set(RELIABILITY_SCHEMA_V1.expectedObjects);
const additiveKeys = keys.filter((key) => !v1Keys.has(key));
const additiveProjection = projection.filter((row) => !v1Keys.has(`${row.type}:${row.name}`));

if (projection.length !== 69 || additiveKeys.length !== 20) fail("expected exact 49 + 20 closure");
if (digest !== RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.structureSha256) {
  fail(`candidate digest drifted (${digest})`);
}
if (JSON.stringify(projection) !== JSON.stringify(candidateFixture.projection)) {
  fail("generated projection differs from pinned fixture");
}
if (JSON.stringify(keys) !== JSON.stringify(candidateFixture.expectedObjects)) {
  fail("generated object catalog differs from pinned fixture");
}
if (JSON.stringify(additiveKeys) !== JSON.stringify(candidateFixture.additiveObjects)) {
  fail("generated additive catalog differs from pinned fixture");
}
if (sha256(JSON.stringify(additiveProjection)) !== candidateFixture.sourceProvenance.additiveProjectionSha256) {
  fail("generated additive projection hash differs from pinned fixture");
}
const installedMarkers = db.prepare(`SELECT version,applied_at,migration_id,description
  FROM reliability_schema_versions ORDER BY version`).all();
if (JSON.stringify(installedMarkers) !== JSON.stringify(baseFixture.marker)) fail("Phase A changed schema authority markers");
if (db.prepare("SELECT COUNT(*) count FROM reliability_schema_contracts").get().count !== 0) {
  fail("Phase A inserted an authority contract");
}
for (const table of [
  "automation_release_manifests",
  "automation_deployment_attestations",
  "source_event_runtime_provenance",
]) {
  if (db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count !== 0) fail(`Phase A ${table} is not empty`);
}

db.exec("BEGIN IMMEDIATE");
try {
  db.exec(rollbackSql);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
const rollbackRows = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
  WHERE type IN ('table','index','trigger') ORDER BY type,name`).all();
const rollback = await assessReliabilityStructure(rollbackRows, RELIABILITY_SCHEMA_V1);
if (!rollback.proven || rollback.digest !== baseFixture.structureSha256) {
  fail(`rollback did not restore exact production v1 (${rollback.digest})`);
}
const rollbackMarkers = db.prepare(`SELECT version,applied_at,migration_id,description
  FROM reliability_schema_versions ORDER BY version`).all();
if (JSON.stringify(rollbackMarkers) !== JSON.stringify(baseFixture.marker)) fail("rollback changed schema authority markers");

console.log(JSON.stringify({
  status: "candidate_exact",
  authority: false,
  remoteObserved: false,
  baseVariantId: RELIABILITY_SCHEMA_V1.variantId,
  baseDigest: before.digest,
  variantId: RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.variantId,
  candidateMigrationId: RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.migrationId,
  objectCount: projection.length,
  additiveObjectCount: additiveKeys.length,
  structureSha256: digest,
  distinctFromCleanBootstrapV2: digest !== RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.structureSha256,
  rollbackStructureSha256: rollback.digest,
}));
