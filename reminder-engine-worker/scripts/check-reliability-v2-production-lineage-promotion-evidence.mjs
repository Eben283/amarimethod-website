import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const OBSERVED_PROMOTION_FIXTURE_SHA256 = "cc9783c2e4ac903ff33307dec3e707a603c194a1d8bfb24e8b02183d0dae9537";
export const PHYSICAL_PROJECTION_FIXTURE_SHA256 = "a51924927c49d9981e8fe77cebd66c079acbd4f18413f6a47242f52aee4fcaef";
export const PROMOTION_SQL_SHA256 = "8af94319d15c184085b79f22c0b3054546ae59528c51f66f8094909e9b9df55c";
export const STRUCTURE_SHA256 = "8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62";
export const FINAL_MIGRATION_ID = "reliability-spine-v2-production-lineage-8c7245ae";

const COUNTS_QUERY = "SELECT (SELECT COUNT(*) FROM automation_release_manifests) AS manifest_count, (SELECT COUNT(*) FROM automation_deployment_attestations) AS attestation_count, (SELECT COUNT(*) FROM source_event_runtime_provenance) AS provenance_count, (SELECT COUNT(*) FROM reconciliation_runs) AS reconciliation_count, (SELECT COUNT(*) FROM reconciliation_runs WHERE family='follow-up-session-reminders') AS follow_up_reconciliation_count, (SELECT COUNT(*) FROM sqlite_master WHERE name='reliability_v2_production_lineage_promotion_gate') AS transient_gate_count";

const fixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-promotion-observed-primary.v1.json",
  import.meta.url,
);
const physicalFixtureUrl = new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-observed-primary.v1.json",
  import.meta.url,
);
const promotionSqlUrl = new URL(
  "../reliability-spine-v2-production-lineage-promote.local.sql",
  import.meta.url,
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const gitBlobSha1 = (value) => createHash("sha1")
  .update(`blob ${Buffer.byteLength(value)}\0`)
  .update(value)
  .digest("hex");
const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = (message) => { throw new Error(`observed promotion evidence invalid: ${message}`); };

const EXPECTED_MARKERS = Object.freeze([
  Object.freeze({
    version: 1,
    applied_at: 1787631973000,
    migration_id: "reliability-spine-v1",
    description: "Durable source events, lifecycle instances, obligations, receipts, reconciliation, and exceptions",
  }),
  Object.freeze({
    version: 2,
    applied_at: 1787803363000,
    migration_id: FINAL_MIGRATION_ID,
    description: "Authenticated release manifests, deployment attestations, and source-event runtime provenance",
  }),
]);

export function validateObservedPromotionEvidence({
  fixtureSource,
  physicalFixtureSource,
  promotionSqlSource,
  requireFixtureFileHash = true,
}) {
  if (requireFixtureFileHash && sha256(fixtureSource) !== OBSERVED_PROMOTION_FIXTURE_SHA256) {
    fail("observed-promotion fixture file hash mismatch");
  }
  if (sha256(physicalFixtureSource) !== PHYSICAL_PROJECTION_FIXTURE_SHA256) {
    fail("physical projection fixture file hash mismatch");
  }
  if (sha256(promotionSqlSource) !== PROMOTION_SQL_SHA256
    || Buffer.byteLength(promotionSqlSource) !== 52835
    || gitBlobSha1(promotionSqlSource) !== "bfc7b48335b8b1e6328f524cd9762fa5546ffa11") {
    fail("promotion SQL source identity mismatch");
  }

  const fixture = JSON.parse(fixtureSource);
  const physical = JSON.parse(physicalFixtureSource);
  if (fixture.fixtureVersion !== 1
    || fixture.status !== "observed-primary-authority-promoted"
    || fixture.authority !== true
    || fixture.remoteObserved !== true
    || fixture.evidenceCapturedAtUtc !== "2026-08-27T04:27:31Z"
    || fixture.promotionWasExplicitlyAuthorized !== true
    || fixture.replayAuthorized !== false
    || fixture.runtimeRecorderAdopted !== false
    || fixture.schemaVariantId !== "production-live-lineage-v2-authority-8c7245a"
    || fixture.canonicalization !== "sqlite-master-required-closure.v1"
    || fixture.objectCount !== 69
    || fixture.structureSha256 !== STRUCTURE_SHA256) {
    fail("top-level authority identity mismatch");
  }
  if (fixture.physicalProjectionFixtureSha256 !== PHYSICAL_PROJECTION_FIXTURE_SHA256
    || fixture.physicalProjectionFixture !== "docs/automation-truth/fixtures/reliability-v2-production-lineage-observed-primary.v1.json"
    || physical.structureSha256 !== STRUCTURE_SHA256
    || physical.objectCount !== 69
    || sha256(JSON.stringify(physical.projection)) !== STRUCTURE_SHA256) {
    fail("physical projection binding mismatch");
  }

  const markers = fixture.rawPrimaryRows?.schemaVersions;
  const contracts = fixture.rawPrimaryRows?.schemaContracts;
  if (!exact(markers, EXPECTED_MARKERS) || !Array.isArray(contracts) || contracts.length !== 1) {
    fail("raw marker or contract cardinality mismatch");
  }
  const contract = contracts[0];
  if (contract.version !== 2
    || contract.migration_id !== FINAL_MIGRATION_ID
    || contract.canonicalization !== "sqlite-master-required-closure.v1"
    || contract.structure_sha256 !== STRUCTURE_SHA256
    || contract.expected_objects_json !== JSON.stringify(physical.expectedObjects)
    || contract.applied_at !== EXPECTED_MARKERS[1].applied_at) {
    fail("raw contract bytes or marker timestamp mismatch");
  }

  const expectedZeroCounts = {
    automation_release_manifests: 0,
    automation_deployment_attestations: 0,
    source_event_runtime_provenance: 0,
    reconciliation_runs: 0,
    follow_up_reconciliation_runs: 0,
    transient_promotion_gate: 0,
  };
  if (!exact(fixture.primaryCounts, expectedZeroCounts)) fail("primary zero-count evidence mismatch");

  const authority = fixture.authorityAssessment || {};
  if (authority.proven !== true
    || authority.reason !== "schema_v2_exact_authority"
    || authority.version !== 2
    || authority.migrationState !== "current_v2"
    || authority.appliedAt !== EXPECTED_MARKERS[1].applied_at
    || authority.structureObjectCount !== 69
    || authority.structureSha256 !== STRUCTURE_SHA256) {
    fail("source authority assessment mismatch");
  }
  if (!exact(fixture.staffHealth, {
    truth: "Degraded",
    reason: "coverage_missing",
    schemaVersion: 2,
    coverageRows: 0,
    note: "Schema authority promotion does not create reconciliation coverage or adopt the runtime recorder.",
  })) fail("coverage truth mismatch");

  const read = fixture.readEvidence || {};
  if (read.cloudflareAccountId !== "fa2b6f2441129b259dd5dea74045721b"
    || read.trustedD1AppliedAtUtc !== "2026-08-27T04:02:43.000Z"
    || read.captureStartedAtUtc !== "2026-08-27T04:25:51Z"
    || read.captureCompletedAtUtc !== fixture.evidenceCapturedAtUtc
    || read.databaseId !== "089d810a-9d2d-43a4-8f1d-dc3620835557"
    || read.databaseName !== "amari-automation"
    || read.servedBy !== "v3-prod"
    || read.servedByPrimary !== true
    || read.rowsWritten !== 0
    || read.changedDb !== false
    || read.requiredProjectionRows !== 69
    || read.projectionComparedByteForByteToPhysicalFixture !== true
    || read.markerContractTimestampEqual !== true
    || read.countsQuery !== COUNTS_QUERY
    || read.countsQuerySha256 !== sha256(COUNTS_QUERY)
    || read.postflightScriptPath !== "/private/tmp/amari-phase-b-postflight.mjs"
    || read.postflightScriptSha256 !== "ed541357a8ba2c8186f935e603744b69aba8fada0a37ef2833942caf75ed7fe4"
    || read.authorityReadbackScriptPath !== "/private/tmp/amari-phase-b-authority-readback.mjs"
    || read.authorityReadbackScriptSha256 !== "310fbaa6aa857959f56361f49c05f273d2339ff786c7ac4e07a3e66f910db382") {
    fail("primary read provenance mismatch");
  }

  const promotion = fixture.promotionEvidence || {};
  if (promotion.repository !== "Eben283/amarimethod-website"
    || promotion.sourceMainAtExecution !== "06c4abe956415fe6c736edfcd9cf96365eef739c"
    || promotion.reviewedPullRequest !== 503
    || promotion.reviewedHead !== "4702fcf7eafd34fbdf9f42fce1d4dd9fd58dd3f3"
    || promotion.reviewedMerge !== "54c1595fa39f7b4a924701519f92b4346543d3ef"
    || promotion.reviewedTree !== "f7edcce5646b72235181a7a686863ae6aa2c32f6"
    || promotion.promotionFile !== "reminder-engine-worker/reliability-spine-v2-production-lineage-promote.local.sql"
    || promotion.promotionFileSha256 !== PROMOTION_SQL_SHA256
    || promotion.promotionFileGitBlob !== "bfc7b48335b8b1e6328f524cd9762fa5546ffa11"
    || promotion.promotionFileBytes !== 52835
    || promotion.wranglerVersion !== "4.125.0"
    || promotion.executionMechanism !== "D1 remote SQL-file import through pinned Wrangler"
    || promotion.processAttempts !== 1
    || promotion.processExitCode !== 0
    || promotion.stdoutWasJson !== false
    || promotion.providerApplyReceiptParsed !== false
    || promotion.blindRetryPerformed !== false
    || promotion.successBasis !== "Exact independent primary-D1 postflight, not process stdout"
    || promotion.prePromotionBookmark !== "000024cc-00000016-000050d4-f8c03021259ccaf75b391cd075661925"
    || promotion.postPromotionBookmark !== "000024cc-00000024-000050d4-e61b5dded0148fe961ef9ca82805c1f3"
    || promotion.prePromotionBookmark === promotion.postPromotionBookmark) {
    fail("promotion execution provenance mismatch");
  }

  const worker = fixture.workerEvidence || {};
  if (worker.worker !== "reminder-engine"
    || worker.deploymentUnchanged !== true
    || worker.observedWithinCaptureWindow !== true
    || worker.latestDeploymentId !== "fa1d09eb-a0af-47e9-bc6e-a44652d59dc9"
    || worker.latestVersionId !== "121f69d8-770f-4c58-adab-0574bece9f1d"
    || worker.latestDeploymentCreatedAtUtc !== "2026-08-26T16:09:42.218627Z") {
    fail("standalone Worker non-deployment evidence mismatch");
  }
  if (!Array.isArray(fixture.limitations)
    || !fixture.limitations.some((line) => line.includes("does not claim a provider apply receipt"))
    || !fixture.limitations.some((line) => line.includes("does not prove reconciliation coverage"))
    || !fixture.limitations.some((line) => line.includes("No replay, rollback"))) {
    fail("limitations do not preserve the evidence boundary");
  }

  return {
    status: "exact_observed_phase_b_authority",
    authority: true,
    schemaVersion: 2,
    migrationId: FINAL_MIGRATION_ID,
    appliedAt: EXPECTED_MARKERS[1].applied_at,
    objectCount: 69,
    structureSha256: STRUCTURE_SHA256,
    healthTruth: "Degraded",
    healthReason: "coverage_missing",
    providerApplyReceiptParsed: false,
    processAttempts: 1,
  };
}

export function validateCheckedInObservedPromotionEvidence() {
  return validateObservedPromotionEvidence({
    fixtureSource: readFileSync(fixtureUrl, "utf8"),
    physicalFixtureSource: readFileSync(physicalFixtureUrl, "utf8"),
    promotionSqlSource: readFileSync(promotionSqlUrl, "utf8"),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(validateCheckedInObservedPromotionEvidence()));
}
