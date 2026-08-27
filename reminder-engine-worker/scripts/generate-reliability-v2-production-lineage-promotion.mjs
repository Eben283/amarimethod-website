import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const OBSERVED_FIXTURE_SHA256 = "a51924927c49d9981e8fe77cebd66c079acbd4f18413f6a47242f52aee4fcaef";
export const FINAL_MIGRATION_ID = "reliability-spine-v2-production-lineage-8c7245ae";
export const FINAL_DESCRIPTION = "Authenticated release manifests, deployment attestations, and source-event runtime provenance";

const EXPECTED_STRUCTURE_SHA256 = "8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62";
const EXPECTED_BASE_SHA256 = "ff5e22ca1c320ac76bf41e87883f49506f581bf7a1643f09219af28308930c7c";
const EXPECTED_V1_MARKER = Object.freeze({
  version: 1,
  applied_at: 1787631973000,
  migration_id: "reliability-spine-v1",
  description: "Durable source events, lifecycle instances, obligations, receipts, reconciliation, and exceptions",
});
const ADDITIVE_TABLES = Object.freeze([
  "automation_deployment_attestations",
  "automation_release_manifests",
  "reliability_schema_contracts",
  "source_event_runtime_provenance",
]);

const observedFixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-observed-primary.v1.json",
  import.meta.url,
);
const baseFixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json",
  import.meta.url,
);
const promotionSqlUrl = new URL(
  "../reliability-spine-v2-production-lineage-promote.local.sql",
  import.meta.url,
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(`production-lineage v2 promotion generation failed: ${message}`); };
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function generatePromotionSql({ observedFixtureSource, baseFixtureSource }) {
  if (sha256(observedFixtureSource) !== OBSERVED_FIXTURE_SHA256) fail("observed fixture file hash mismatch");
  if (sha256(baseFixtureSource) !== EXPECTED_BASE_SHA256) fail("production-v1 fixture file hash mismatch");

  const observed = JSON.parse(observedFixtureSource);
  const base = JSON.parse(baseFixtureSource);
  if (observed.remoteObserved !== true || observed.authority !== false
    || observed.promotionAuthorized !== false
    || observed.status !== "observed-primary-physical-install-not-promoted") {
    fail("fixture is not the exact observed, non-authoritative primary state");
  }
  if (observed.structureSha256 !== EXPECTED_STRUCTURE_SHA256
    || observed.objectCount !== 69 || observed.additiveObjectCount !== 20
    || observed.matchesCleanBootstrapV2 !== false) {
    fail("observed closure identity mismatch");
  }
  if (observed.finalMigrationId !== null
    || observed.candidateMigrationId === FINAL_MIGRATION_ID
    || FINAL_MIGRATION_ID === "reliability-spine-v2-deployment-attestation") {
    fail("final migration identity is not distinct from candidate identities");
  }
  if (!exactJson(observed.marker, [EXPECTED_V1_MARKER])
    || observed.schemaContractRowCount !== 0
    || observed.transientGatePresent !== false
    || observed.priorTableCountsUnchanged !== true) {
    fail("observed marker, contract, gate, or prior-count evidence mismatch");
  }
  if (observed.readEvidence?.servedBy !== "v3-prod"
    || observed.readEvidence?.servedByPrimary !== true
    || observed.readEvidence?.rowsWritten !== 0
    || observed.readEvidence?.changedDb !== false
    || observed.readEvidence?.projectionComparedByteForByteToSourceCandidate !== true) {
    fail("observed primary readback provenance mismatch");
  }
  if (!exactJson(Object.keys(observed.newTableCounts || {}).sort(), [...ADDITIVE_TABLES].sort())) {
    fail("additive table-count evidence is incomplete");
  }
  for (const table of ADDITIVE_TABLES) {
    if (!Number.isInteger(observed.newTableCounts[table]) || observed.newTableCounts[table] !== 0) {
      fail(`additive table ${table} is not proven empty with a numeric count`);
    }
  }

  const projection = observed.projection || [];
  const expectedObjects = observed.expectedObjects || [];
  const additiveObjects = observed.additiveObjects || [];
  const projectionObjects = projection.map((row) => `${row.type}:${row.name}`);
  const baseObjects = new Set((base.projection || []).map((row) => `${row.type}:${row.name}`));
  const derivedAdditions = projectionObjects.filter((object) => !baseObjects.has(object));
  if (!exactJson(projectionObjects, expectedObjects)
    || new Set(projectionObjects).size !== 69
    || !exactJson(derivedAdditions, additiveObjects)
    || new Set(additiveObjects).size !== 20
    || sha256(JSON.stringify(projection)) !== EXPECTED_STRUCTURE_SHA256) {
    fail("literal observed projection, object closure, or digest mismatch");
  }
  for (const row of projection) {
    if (!new Set(["table", "index", "trigger"]).has(row.type)
      || typeof row.name !== "string" || typeof row.table !== "string" || typeof row.sql !== "string") {
      fail("malformed observed sqlite_master row");
    }
  }

  const catalogJson = JSON.stringify(projection.map((row) => ({
    type: row.type,
    name: row.name,
    tbl_name: row.table,
    sql: row.sql,
  })));
  const expectedObjectsJson = JSON.stringify(expectedObjects);
  const additiveObjectsJson = JSON.stringify(additiveObjects);
  const gate = "reliability_v2_production_lineage_promotion_gate";

  return `-- DO NOT APPLY. REVIEWED PHASE-B PROMOTION SOURCE; SEPARATE LIVE AUTHORIZATION REQUIRED.
-- Unregistered and unimported. This file is generated only from the immutable
-- observed-primary fixture SHA-256 ${OBSERVED_FIXTURE_SHA256}.
-- It must run, if separately authorized later, through one officially
-- transactional D1 file/migration mechanism. Arbitrary Worker exec() is not a
-- whole-file atomicity guarantee. Re-run is intentionally rejected.

CREATE TABLE ${gate} (
  accepted INTEGER NOT NULL CHECK (accepted = 1)
);

-- Exact pre-promotion state only: sole historical v1 marker, all 69 observed
-- sqlite_master bytes, exactly 20 additions, and no v2 evidence rows.
INSERT INTO ${gate} (accepted)
WITH expected(type,name,tbl_name,sql) AS (
  SELECT json_extract(value, '$.type'), json_extract(value, '$.name'),
         json_extract(value, '$.tbl_name'), json_extract(value, '$.sql')
  FROM json_each(${sqlLiteral(catalogJson)})
), required_tables(name) AS (
  SELECT name FROM expected WHERE type = 'table'
), physical(type,name,tbl_name,sql) AS (
  SELECT type,name,tbl_name,sql FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_autoindex%'
    AND (
      (type = 'table' AND name IN (SELECT name FROM required_tables))
      OR (type IN ('index','trigger') AND tbl_name IN (SELECT name FROM required_tables))
    )
), expected_additions(object_key) AS (
  SELECT value FROM json_each(${sqlLiteral(additiveObjectsJson)})
), physical_additions(object_key) AS (
  SELECT type || ':' || name FROM physical
  WHERE type || ':' || name IN (SELECT object_key FROM expected_additions)
)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM reliability_schema_versions) = 1
  AND EXISTS (
    SELECT 1 FROM reliability_schema_versions
    WHERE version = 1
      AND applied_at = ${EXPECTED_V1_MARKER.applied_at}
      AND migration_id = ${sqlLiteral(EXPECTED_V1_MARKER.migration_id)}
      AND description = ${sqlLiteral(EXPECTED_V1_MARKER.description)}
  )
  AND (SELECT COUNT(*) FROM reliability_schema_contracts) = 0
  AND (SELECT COUNT(*) FROM automation_release_manifests) = 0
  AND (SELECT COUNT(*) FROM automation_deployment_attestations) = 0
  AND (SELECT COUNT(*) FROM source_event_runtime_provenance) = 0
  AND (SELECT COUNT(*) FROM expected) = 69
  AND (SELECT COUNT(DISTINCT type || ':' || name) FROM expected) = 69
  AND (SELECT COUNT(*) FROM physical) = 69
  AND NOT EXISTS (SELECT type,name,tbl_name,sql FROM expected EXCEPT SELECT type,name,tbl_name,sql FROM physical)
  AND NOT EXISTS (SELECT type,name,tbl_name,sql FROM physical EXCEPT SELECT type,name,tbl_name,sql FROM expected)
  AND (SELECT COUNT(*) FROM expected_additions) = 20
  AND (SELECT COUNT(*) FROM physical_additions) = 20
  AND NOT EXISTS (SELECT object_key FROM expected_additions EXCEPT SELECT object_key FROM physical_additions)
  AND NOT EXISTS (SELECT object_key FROM physical_additions EXCEPT SELECT object_key FROM expected_additions)
THEN 1 ELSE 0 END;

-- Contract first, using one trusted D1 timestamp.
INSERT INTO reliability_schema_contracts
  (version,migration_id,canonicalization,structure_sha256,expected_objects_json,applied_at)
VALUES (
  2,
  ${sqlLiteral(FINAL_MIGRATION_ID)},
  'sqlite-master-required-closure.v1',
  '${EXPECTED_STRUCTURE_SHA256}',
  ${sqlLiteral(expectedObjectsJson)},
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- Revalidate every contract byte and require the schema/evidence state to stay
-- exact before removing the transaction guard.
DELETE FROM ${gate};
INSERT INTO ${gate} (accepted)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM reliability_schema_versions) = 1
  AND EXISTS (
    SELECT 1 FROM reliability_schema_versions
    WHERE version = 1
      AND applied_at = ${EXPECTED_V1_MARKER.applied_at}
      AND migration_id = ${sqlLiteral(EXPECTED_V1_MARKER.migration_id)}
      AND description = ${sqlLiteral(EXPECTED_V1_MARKER.description)}
  )
  AND (SELECT COUNT(*) FROM reliability_schema_contracts) = 1
  AND EXISTS (
    SELECT 1 FROM reliability_schema_contracts
    WHERE version = 2
      AND migration_id = ${sqlLiteral(FINAL_MIGRATION_ID)}
      AND canonicalization = 'sqlite-master-required-closure.v1'
      AND structure_sha256 = '${EXPECTED_STRUCTURE_SHA256}'
      AND expected_objects_json = ${sqlLiteral(expectedObjectsJson)}
      AND applied_at > 0
  )
  AND (SELECT COUNT(*) FROM automation_release_manifests) = 0
  AND (SELECT COUNT(*) FROM automation_deployment_attestations) = 0
  AND (SELECT COUNT(*) FROM source_event_runtime_provenance) = 0
THEN 1 ELSE 0 END;
DROP TABLE ${gate};

-- FINAL SQL STATEMENT. It reuses the exact contract timestamp. Nothing may
-- follow this marker statement.
INSERT INTO reliability_schema_versions (version,applied_at,migration_id,description)
SELECT 2,applied_at,migration_id,${sqlLiteral(FINAL_DESCRIPTION)}
FROM reliability_schema_contracts
WHERE version = 2
  AND migration_id = ${sqlLiteral(FINAL_MIGRATION_ID)}
  AND canonicalization = 'sqlite-master-required-closure.v1'
  AND structure_sha256 = '${EXPECTED_STRUCTURE_SHA256}'
  AND expected_objects_json = ${sqlLiteral(expectedObjectsJson)};
`;
}

export function generateCheckedInPromotionSql() {
  return generatePromotionSql({
    observedFixtureSource: readFileSync(observedFixtureUrl, "utf8"),
    baseFixtureSource: readFileSync(baseFixtureUrl, "utf8"),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const generated = generateCheckedInPromotionSql();
  if (process.argv[2] === "--check") {
    const checkedIn = readFileSync(promotionSqlUrl, "utf8");
    if (checkedIn !== generated) fail("checked-in promotion SQL differs from exact generated source");
    console.log(JSON.stringify({
      status: "exact_phase_b_source",
      authority: false,
      promotionAuthorized: false,
      observedFixtureSha256: OBSERVED_FIXTURE_SHA256,
      migrationId: FINAL_MIGRATION_ID,
      structureSha256: EXPECTED_STRUCTURE_SHA256,
      objectCount: 69,
      additiveObjectCount: 20,
      markerIsFinalStatement: true,
    }));
  } else {
    process.stdout.write(generated);
  }
}
