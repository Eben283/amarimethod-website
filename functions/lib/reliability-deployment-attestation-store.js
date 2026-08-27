/**
 * Phase D persistence helpers. This source-only module is intentionally not
 * imported by any runtime entrypoint. A later behavior release must place the
 * provenance statement in the same D1 batch as source/lifecycle/obligation
 * acceptance, before dispatch or any provider effect.
 */
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";
import { verifyDeploymentAttestationEnvelope } from "./automation-truth-phase-d.js";
import { RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY } from "./reliability-schema-authority.js";

const MIGRATION_ID = RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.migrationId;
const STRUCTURE_CANONICALIZATION = "sqlite-master-required-closure.v1";
const SHA256 = /^[a-f0-9]{64}$/;
const RFC3339_MILLIS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Matches the existing normalized/audit evidence-retention policy. A future
// behavior release must keep the policy owner and deletion path explicit.
const MAX_AUTHORITY_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

export class DeploymentAttestationRefusal extends Error {
  constructor(status, reasonCodes, message = "deployment attestation refused") {
    super(message);
    this.name = "DeploymentAttestationRefusal";
    this.status = status;
    this.reasonCodes = [...new Set(reasonCodes)].sort();
  }
}

function changesOf(result) {
  return Number(result?.meta?.changes || 0);
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function requiredDigest(value, label) {
  const normalized = requiredText(value, label).toLowerCase();
  if (!SHA256.test(normalized)) throw new TypeError(`${label} must be a SHA-256 digest`);
  return normalized;
}

function requiredInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function trustedClockReading(clock) {
  const value = requiredText(clock(), "trusted recorder clock reading");
  if (!RFC3339_MILLIS_UTC.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError("trusted recorder clock must return canonical RFC3339 UTC with millisecond precision");
  }
  return value;
}

async function first(db, sql, ...values) {
  return db.prepare(sql).bind(...values).first();
}

async function exactStoredAuthority(db, release, envelopeJson) {
  const manifest = await first(db, "SELECT * FROM automation_release_manifests WHERE release_manifest_id = ?", release.releaseManifestId);
  const attestation = await first(db, "SELECT * FROM automation_deployment_attestations WHERE payload_sha256 = ?", envelopeJson.payloadDigest);
  if (manifest && manifest.canonical_json !== envelopeJson.releaseJson) {
    throw new DeploymentAttestationRefusal("Broken", ["release_manifest_content_collision"]);
  }
  if (attestation && (attestation.canonical_json !== envelopeJson.envelopeJson
    || attestation.deployment_attestation_id !== envelopeJson.deploymentAttestationId)) {
    throw new DeploymentAttestationRefusal("Broken", ["deployment_attestation_content_collision"]);
  }
  if (!manifest || !attestation) return null;
  return { manifest, attestation };
}

async function assertSchemaAuthority(db, release) {
  let contract;
  try {
    contract = await first(db, "SELECT * FROM reliability_schema_contracts WHERE version = ?", release.requiredSchema.version);
  } catch {
    throw new DeploymentAttestationRefusal("Unknown", ["schema_structure_authority_unavailable"]);
  }
  if (!contract) throw new DeploymentAttestationRefusal("Unknown", ["schema_structure_authority_missing"]);
  if (contract.migration_id !== release.requiredSchema.migrationId
    || contract.canonicalization !== STRUCTURE_CANONICALIZATION
    || contract.structure_sha256 !== release.requiredSchema.structureSha256) {
    throw new DeploymentAttestationRefusal("Broken", ["schema_structure_authority_mismatch"]);
  }
}

function releaseInsert(db, release, releaseJson, retentionUntil) {
  return db.prepare(`INSERT INTO automation_release_manifests
    (release_manifest_id,release_manifest_digest,family,source_repository,source_revision,source_tree,worker_version,runtime_version,lockfile_sha256,
     bundle_sha256,modules_digest,compiler_id,compiler_artifact_sha256,spec_digest,compiled_plan_digest,
     handler_registry_digest,message_catalog_digest,expected_bindings_digest,workflow_id,workflow_version,
     workflow_state,workflow_document_sha256,schema_database_id,schema_migration_id,schema_version,
     schema_source_sha256,schema_structure_sha256,follow_up_delivery_release,follow_up_assigned_user_delivery,
     declared_effect_owner,canonical_json,created_at,retention_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(release_manifest_id) DO NOTHING`).bind(
    release.releaseManifestId, release.releaseManifestDigest, release.family, release.source.repository,
    release.source.revision, release.source.tree, release.runtimeIdentity.workerVersion,
    release.runtimeIdentity.runtimeVersion, release.source.lockfile.sha256, release.artifacts.bundle.sha256,
    release.modulesDigest, release.compiledPlan.compilerId, release.compiledPlan.compilerArtifactSha256,
    release.compiledPlan.specDigest, release.compiledPlan.compiledPlanDigest, release.compiledPlan.handlerRegistryDigest,
    release.compiledPlan.messageCatalogDigest, release.expectedBindingsDigest, release.workflow.workflowId,
    release.workflow.version, release.workflow.state, release.workflow.documentSha256, release.requiredSchema.databaseId,
    release.requiredSchema.migrationId, release.requiredSchema.version, release.requiredSchema.sourceSha256,
    release.requiredSchema.structureSha256, release.deliveryGuards.followUpDeliveryRelease,
    release.deliveryGuards.followUpAssignedUserDelivery,
    `${release.effectOwner.system}:${release.effectOwner.mode}:${release.effectOwner.effectful ? "effectful" : "inert"}`,
    releaseJson, Date.parse(release.createdAt), retentionUntil,
  );
}

async function attestationInsert(db, release, envelope, envelopeJson, recordedAt, retentionUntil) {
  const payload = envelope.payload;
  const observed = payload.observed;
  const evidence = observed.authorityEvidence;
  return db.prepare(`INSERT INTO automation_deployment_attestations
    (deployment_attestation_id,release_manifest_id,release_manifest_digest,platform,service,environment,
     deployment_id,version_id,traffic_percent,source_revision,source_tree,worker_version,runtime_version,bundle_sha256,modules_digest,
     observed_bindings_digest,schema_database_id,schema_migration_id,schema_version,schema_source_sha256,
     schema_structure_sha256,workflow_id,workflow_version,workflow_document_sha256,follow_up_delivery_release,
     follow_up_assigned_user_delivery,build_evidence_reference,build_evidence_sha256,
     cloudflare_evidence_reference,cloudflare_evidence_sha256,d1_schema_evidence_reference,d1_schema_evidence_sha256,
     d1_workflow_evidence_reference,d1_workflow_evidence_sha256,payload_sha256,authentication_method,
     authentication_key_id,authentication_signature,canonical_json,observed_at,attested_at,recorded_at,expires_at,retention_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(payload_sha256) DO NOTHING`).bind(
    envelope.deploymentAttestationId, release.releaseManifestId, release.releaseManifestDigest,
    observed.platform, observed.service, observed.environment, observed.deploymentId, observed.versionId,
    observed.trafficPercent, observed.source.revision, observed.source.tree, release.runtimeIdentity.workerVersion,
    release.runtimeIdentity.runtimeVersion, observed.artifacts.bundle.sha256,
    await sha256(observed.artifacts.modules), await sha256(observed.bindings), observed.schema.databaseId,
    observed.schema.migrationId, observed.schema.version, observed.schema.sourceSha256, observed.schema.structureSha256,
    observed.workflow.workflowId, observed.workflow.version, observed.workflow.documentSha256,
    observed.deliveryGuards.followUpDeliveryRelease, observed.deliveryGuards.followUpAssignedUserDelivery,
    evidence.build.reference, evidence.build.sha256, evidence.cloudflare.reference, evidence.cloudflare.sha256,
    evidence.d1Schema.reference, evidence.d1Schema.sha256, evidence.d1Workflow.reference, evidence.d1Workflow.sha256,
    envelope.payloadDigest, envelope.authentication.method, envelope.authentication.keyId,
    envelope.authentication.signature, envelopeJson, Date.parse(payload.observedAt), Date.parse(payload.attestedAt),
    recordedAt, Date.parse(payload.expiresAt), retentionUntil,
  );
}

/** Verify first; persist only authenticated, fresh, exact authority. */
export async function recordVerifiedDeploymentAttestation(db, {
  releaseManifest, envelope, keyring, trustedClock = () => new Date().toISOString(), retentionUntil,
}) {
  if (!db) throw new TypeError("reliability database is required");
  if (typeof trustedClock !== "function") throw new TypeError("trustedClock must be a recorder-owned clock function");
  const verification = await verifyDeploymentAttestationEnvelope({
    releaseManifest, envelope, keyring, now: trustedClockReading(trustedClock),
  });
  if (verification.problems.length) {
    throw new DeploymentAttestationRefusal("Broken", verification.problems);
  }
  if (verification.freshness.status !== "Fresh") {
    throw new DeploymentAttestationRefusal("Unknown", [verification.freshness.reason]);
  }
  const release = verification.releaseManifest;
  const verifiedEnvelope = verification.envelope;
  const retention = requiredInteger(retentionUntil, "retentionUntil");
  if (retention < Date.parse(verifiedEnvelope.payload.expiresAt)) throw new TypeError("retentionUntil must include the attestation validity window");
  if (retention > Date.parse(verifiedEnvelope.payload.attestedAt) + MAX_AUTHORITY_RETENTION_MS) {
    throw new TypeError("retentionUntil may not exceed the 400-day normalized authority retention policy");
  }
  await assertSchemaAuthority(db, release);

  const envelopeJson = {
    payloadDigest: verifiedEnvelope.payloadDigest,
    deploymentAttestationId: verifiedEnvelope.deploymentAttestationId,
    releaseJson: canonicalJson(release),
    envelopeJson: canonicalJson(verifiedEnvelope),
  };
  const replay = await exactStoredAuthority(db, release, envelopeJson);
  if (replay) return { created: false, replayed: true, ...replay };

  // Re-read the recorder clock immediately before the atomic write so an
  // attestation cannot cross its exclusive expiry after signature checking.
  const recordedAt = Date.parse(trustedClockReading(trustedClock));
  if (!Number.isInteger(recordedAt)
    || recordedAt < Date.parse(verifiedEnvelope.payload.attestedAt)
    || recordedAt >= Date.parse(verifiedEnvelope.payload.expiresAt)) {
    throw new DeploymentAttestationRefusal("Unknown", ["attestation_expired_before_recording"]);
  }

  let results;
  try {
    results = await db.batch([
      releaseInsert(db, release, envelopeJson.releaseJson, retention),
      await attestationInsert(db, release, verifiedEnvelope, envelopeJson.envelopeJson, recordedAt, retention),
    ]);
  } catch (error) {
    const raced = await exactStoredAuthority(db, release, envelopeJson);
    if (raced) return { created: false, replayed: true, ...raced };
    if (/overlapping deployment attestation/i.test(String(error?.message))) {
      throw new DeploymentAttestationRefusal("Broken", ["overlapping_deployment_authority_conflict"]);
    }
    if (/conflicting immutable Cloudflare version identity/i.test(String(error?.message))) {
      throw new DeploymentAttestationRefusal("Broken", ["immutable_cloudflare_version_identity_conflict"]);
    }
    throw error;
  }
  const stored = await exactStoredAuthority(db, release, envelopeJson);
  if (!stored) throw new Error("verified deployment authority did not persist atomically");
  const created = changesOf(results?.[1]) === 1;
  return { created, replayed: !created, ...stored };
}

/**
 * Returns only a statement. The future adoption must include it in the same
 * `db.batch` that inserts the accepted source, lifecycle, and obligations.
 * It must run before a dispatched transition or provider command.
 */
export function prepareSourceRuntimeProvenanceInsert(db, {
  sourceEventId, lifecycleInstanceId, invocationId, deploymentAttestationId,
  cloudflareVersionId, workflowDocumentSha256, schemaStructureSha256,
  followUpDeliveryRelease, followUpAssignedUserDelivery, boundAt, retentionUntil,
}) {
  if (!db) throw new TypeError("reliability database is required");
  const guardOne = requiredText(followUpDeliveryRelease, "followUpDeliveryRelease");
  const guardTwo = requiredText(followUpAssignedUserDelivery, "followUpAssignedUserDelivery");
  if (guardOne !== "approved" || guardTwo !== "approved") {
    throw new DeploymentAttestationRefusal("Broken", ["delivery_guard_mismatch"]);
  }
  return db.prepare(`INSERT INTO source_event_runtime_provenance
    (source_event_id,lifecycle_instance_id,invocation_id,deployment_attestation_id,cloudflare_version_id,
     workflow_document_sha256_at_bind,schema_structure_sha256_at_bind,follow_up_delivery_release_at_bind,
     follow_up_assigned_user_delivery_at_bind,bound_at,retention_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
    requiredText(sourceEventId, "sourceEventId"), requiredText(lifecycleInstanceId, "lifecycleInstanceId"),
    requiredText(invocationId, "invocationId"), requiredText(deploymentAttestationId, "deploymentAttestationId"),
    requiredText(cloudflareVersionId, "cloudflareVersionId"), requiredDigest(workflowDocumentSha256, "workflowDocumentSha256"),
    requiredDigest(schemaStructureSha256, "schemaStructureSha256"), guardOne, guardTwo,
    requiredInteger(boundAt, "boundAt"), requiredInteger(retentionUntil, "retentionUntil"),
  );
}

export const PHASE_D_MIGRATION_CONTRACT = Object.freeze({
  migrationId: MIGRATION_ID,
  structureCanonicalization: STRUCTURE_CANONICALIZATION,
  runtimeImported: false,
});
