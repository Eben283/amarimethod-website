-- LOCAL-ONLY CANDIDATE. This is not a Wrangler migration and is not loaded by
-- schema.sql or any runtime entrypoint. A future migration runner must perform
-- the documented v2 conflict preflight and sqlite_master structure postflight.

CREATE TABLE IF NOT EXISTS reliability_schema_contracts (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  migration_id TEXT NOT NULL UNIQUE,
  canonicalization TEXT NOT NULL CHECK (canonicalization = 'sqlite-master-required-closure.v1'),
  structure_sha256 TEXT NOT NULL CHECK (length(structure_sha256) = 64 AND structure_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_objects_json TEXT NOT NULL CHECK (json_valid(expected_objects_json)),
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_release_manifests (
  release_manifest_id TEXT PRIMARY KEY,
  release_manifest_digest TEXT NOT NULL UNIQUE CHECK (length(release_manifest_digest) = 64 AND release_manifest_digest NOT GLOB '*[^0-9a-f]*'),
  family TEXT NOT NULL CHECK (family = 'follow-up-session-reminders'),
  source_repository TEXT NOT NULL,
  source_revision TEXT NOT NULL CHECK (length(source_revision) = 40 AND source_revision NOT GLOB '*[^0-9a-f]*'),
  source_tree TEXT NOT NULL CHECK (length(source_tree) = 40 AND source_tree NOT GLOB '*[^0-9a-f]*'),
  worker_version TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  lockfile_sha256 TEXT NOT NULL CHECK (length(lockfile_sha256) = 64 AND lockfile_sha256 NOT GLOB '*[^0-9a-f]*'),
  bundle_sha256 TEXT NOT NULL CHECK (length(bundle_sha256) = 64 AND bundle_sha256 NOT GLOB '*[^0-9a-f]*'),
  modules_digest TEXT NOT NULL CHECK (length(modules_digest) = 64 AND modules_digest NOT GLOB '*[^0-9a-f]*'),
  compiler_id TEXT NOT NULL,
  compiler_artifact_sha256 TEXT NOT NULL CHECK (length(compiler_artifact_sha256) = 64 AND compiler_artifact_sha256 NOT GLOB '*[^0-9a-f]*'),
  spec_digest TEXT NOT NULL CHECK (length(spec_digest) = 64 AND spec_digest NOT GLOB '*[^0-9a-f]*'),
  compiled_plan_digest TEXT NOT NULL CHECK (length(compiled_plan_digest) = 64 AND compiled_plan_digest NOT GLOB '*[^0-9a-f]*'),
  handler_registry_digest TEXT NOT NULL CHECK (length(handler_registry_digest) = 64 AND handler_registry_digest NOT GLOB '*[^0-9a-f]*'),
  message_catalog_digest TEXT NOT NULL CHECK (length(message_catalog_digest) = 64 AND message_catalog_digest NOT GLOB '*[^0-9a-f]*'),
  expected_bindings_digest TEXT NOT NULL CHECK (length(expected_bindings_digest) = 64 AND expected_bindings_digest NOT GLOB '*[^0-9a-f]*'),
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  workflow_state TEXT NOT NULL CHECK (workflow_state = 'published'),
  workflow_document_sha256 TEXT NOT NULL CHECK (length(workflow_document_sha256) = 64 AND workflow_document_sha256 NOT GLOB '*[^0-9a-f]*'),
  schema_database_id TEXT NOT NULL,
  schema_migration_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  schema_source_sha256 TEXT NOT NULL CHECK (length(schema_source_sha256) = 64 AND schema_source_sha256 NOT GLOB '*[^0-9a-f]*'),
  schema_structure_sha256 TEXT NOT NULL CHECK (length(schema_structure_sha256) = 64 AND schema_structure_sha256 NOT GLOB '*[^0-9a-f]*'),
  follow_up_delivery_release TEXT NOT NULL,
  follow_up_assigned_user_delivery TEXT NOT NULL,
  declared_effect_owner TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json)),
  created_at INTEGER NOT NULL,
  retention_until INTEGER NOT NULL CHECK (retention_until >= created_at)
);

CREATE TABLE IF NOT EXISTS automation_deployment_attestations (
  deployment_attestation_id TEXT PRIMARY KEY,
  release_manifest_id TEXT NOT NULL REFERENCES automation_release_manifests(release_manifest_id),
  release_manifest_digest TEXT NOT NULL CHECK (length(release_manifest_digest) = 64 AND release_manifest_digest NOT GLOB '*[^0-9a-f]*'),
  platform TEXT NOT NULL CHECK (platform = 'cloudflare'),
  service TEXT NOT NULL CHECK (service = 'reminder-engine'),
  environment TEXT NOT NULL CHECK (environment = 'production'),
  deployment_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  traffic_percent INTEGER NOT NULL CHECK (traffic_percent = 100),
  source_revision TEXT NOT NULL CHECK (length(source_revision) = 40 AND source_revision NOT GLOB '*[^0-9a-f]*'),
  source_tree TEXT NOT NULL CHECK (length(source_tree) = 40 AND source_tree NOT GLOB '*[^0-9a-f]*'),
  worker_version TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL CHECK (length(bundle_sha256) = 64 AND bundle_sha256 NOT GLOB '*[^0-9a-f]*'),
  modules_digest TEXT NOT NULL CHECK (length(modules_digest) = 64 AND modules_digest NOT GLOB '*[^0-9a-f]*'),
  observed_bindings_digest TEXT NOT NULL CHECK (length(observed_bindings_digest) = 64 AND observed_bindings_digest NOT GLOB '*[^0-9a-f]*'),
  schema_database_id TEXT NOT NULL,
  schema_migration_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  schema_source_sha256 TEXT NOT NULL CHECK (length(schema_source_sha256) = 64 AND schema_source_sha256 NOT GLOB '*[^0-9a-f]*'),
  schema_structure_sha256 TEXT NOT NULL CHECK (length(schema_structure_sha256) = 64 AND schema_structure_sha256 NOT GLOB '*[^0-9a-f]*'),
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  workflow_document_sha256 TEXT NOT NULL CHECK (length(workflow_document_sha256) = 64 AND workflow_document_sha256 NOT GLOB '*[^0-9a-f]*'),
  follow_up_delivery_release TEXT NOT NULL,
  follow_up_assigned_user_delivery TEXT NOT NULL,
  build_evidence_reference TEXT NOT NULL,
  build_evidence_sha256 TEXT NOT NULL CHECK (length(build_evidence_sha256) = 64 AND build_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  cloudflare_evidence_reference TEXT NOT NULL,
  cloudflare_evidence_sha256 TEXT NOT NULL CHECK (length(cloudflare_evidence_sha256) = 64 AND cloudflare_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  d1_schema_evidence_reference TEXT NOT NULL,
  d1_schema_evidence_sha256 TEXT NOT NULL CHECK (length(d1_schema_evidence_sha256) = 64 AND d1_schema_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  d1_workflow_evidence_reference TEXT NOT NULL,
  d1_workflow_evidence_sha256 TEXT NOT NULL CHECK (length(d1_workflow_evidence_sha256) = 64 AND d1_workflow_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  payload_sha256 TEXT NOT NULL UNIQUE CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  authentication_method TEXT NOT NULL CHECK (authentication_method = 'ed25519'),
  authentication_key_id TEXT NOT NULL,
  authentication_signature TEXT NOT NULL CHECK (length(authentication_signature) = 128 AND authentication_signature NOT GLOB '*[^0-9a-f]*'),
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json)),
  observed_at INTEGER NOT NULL,
  attested_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  retention_until INTEGER NOT NULL,
  CHECK (observed_at <= attested_at AND attested_at <= recorded_at AND recorded_at < expires_at),
  CHECK (attested_at - observed_at <= 300000),
  CHECK (expires_at - attested_at <= 900000),
  CHECK (retention_until >= expires_at)
);

CREATE TABLE IF NOT EXISTS source_event_runtime_provenance (
  source_event_id TEXT PRIMARY KEY REFERENCES source_events(source_event_id),
  lifecycle_instance_id TEXT NOT NULL UNIQUE REFERENCES lifecycle_instances(lifecycle_instance_id),
  invocation_id TEXT NOT NULL UNIQUE,
  deployment_attestation_id TEXT NOT NULL REFERENCES automation_deployment_attestations(deployment_attestation_id),
  cloudflare_version_id TEXT NOT NULL,
  workflow_document_sha256_at_bind TEXT NOT NULL CHECK (length(workflow_document_sha256_at_bind) = 64 AND workflow_document_sha256_at_bind NOT GLOB '*[^0-9a-f]*'),
  schema_structure_sha256_at_bind TEXT NOT NULL CHECK (length(schema_structure_sha256_at_bind) = 64 AND schema_structure_sha256_at_bind NOT GLOB '*[^0-9a-f]*'),
  follow_up_delivery_release_at_bind TEXT NOT NULL CHECK (follow_up_delivery_release_at_bind = 'approved'),
  follow_up_assigned_user_delivery_at_bind TEXT NOT NULL CHECK (follow_up_assigned_user_delivery_at_bind = 'approved'),
  bound_at INTEGER NOT NULL,
  retention_until INTEGER NOT NULL CHECK (retention_until >= bound_at)
);

CREATE INDEX IF NOT EXISTS idx_deployment_attestations_latest
  ON automation_deployment_attestations(platform, service, environment, deployment_id, version_id, attested_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_attestations_runtime_version
  ON automation_deployment_attestations(platform, service, environment, version_id, attested_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_attestations_release
  ON automation_deployment_attestations(release_manifest_id, attested_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_runtime_provenance_deployment
  ON source_event_runtime_provenance(deployment_attestation_id, bound_at DESC);

CREATE TRIGGER IF NOT EXISTS automation_deployment_attestations_consistent_insert
BEFORE INSERT ON automation_deployment_attestations
WHEN NOT EXISTS (
  SELECT 1 FROM automation_release_manifests manifest
  JOIN reliability_schema_contracts schema_contract ON schema_contract.version = manifest.schema_version
  WHERE manifest.release_manifest_id = NEW.release_manifest_id
    AND manifest.release_manifest_digest = NEW.release_manifest_digest
    AND manifest.source_revision = NEW.source_revision
    AND manifest.source_tree = NEW.source_tree
    AND manifest.worker_version = NEW.worker_version
    AND manifest.runtime_version = NEW.runtime_version
    AND manifest.bundle_sha256 = NEW.bundle_sha256
    AND manifest.modules_digest = NEW.modules_digest
    AND manifest.expected_bindings_digest = NEW.observed_bindings_digest
    AND manifest.schema_database_id = NEW.schema_database_id
    AND manifest.schema_migration_id = NEW.schema_migration_id
    AND manifest.schema_version = NEW.schema_version
    AND manifest.schema_source_sha256 = NEW.schema_source_sha256
    AND manifest.schema_structure_sha256 = NEW.schema_structure_sha256
    AND schema_contract.migration_id = NEW.schema_migration_id
    AND schema_contract.structure_sha256 = NEW.schema_structure_sha256
    AND manifest.workflow_id = NEW.workflow_id
    AND manifest.workflow_version = NEW.workflow_version
    AND manifest.workflow_document_sha256 = NEW.workflow_document_sha256
    AND manifest.follow_up_delivery_release = NEW.follow_up_delivery_release
    AND manifest.follow_up_assigned_user_delivery = NEW.follow_up_assigned_user_delivery
) BEGIN
  SELECT RAISE(ABORT, 'deployment attestation does not match release or schema authority');
END;

CREATE TRIGGER IF NOT EXISTS automation_deployment_attestations_no_overlap_conflict
BEFORE INSERT ON automation_deployment_attestations
WHEN EXISTS (
  SELECT 1 FROM automation_deployment_attestations existing
  WHERE existing.platform = NEW.platform
    AND existing.service = NEW.service
    AND existing.environment = NEW.environment
    AND existing.deployment_id = NEW.deployment_id
    AND existing.observed_at < NEW.expires_at
    AND NEW.observed_at < existing.expires_at
    AND (
      existing.version_id <> NEW.version_id
      OR (
        existing.version_id = NEW.version_id
        AND existing.source_revision = NEW.source_revision
        AND existing.source_tree = NEW.source_tree
        AND existing.worker_version = NEW.worker_version
        AND existing.runtime_version = NEW.runtime_version
        AND existing.bundle_sha256 = NEW.bundle_sha256
        AND existing.modules_digest = NEW.modules_digest
        AND existing.observed_bindings_digest = NEW.observed_bindings_digest
        AND existing.build_evidence_sha256 = NEW.build_evidence_sha256
        AND (
          existing.release_manifest_digest <> NEW.release_manifest_digest
          OR existing.schema_database_id <> NEW.schema_database_id
          OR existing.schema_migration_id <> NEW.schema_migration_id
          OR existing.schema_version <> NEW.schema_version
          OR existing.schema_source_sha256 <> NEW.schema_source_sha256
          OR existing.schema_structure_sha256 <> NEW.schema_structure_sha256
          OR existing.workflow_id <> NEW.workflow_id
          OR existing.workflow_version <> NEW.workflow_version
          OR existing.workflow_document_sha256 <> NEW.workflow_document_sha256
          OR existing.follow_up_delivery_release <> NEW.follow_up_delivery_release
          OR existing.follow_up_assigned_user_delivery <> NEW.follow_up_assigned_user_delivery
        )
      )
    )
) BEGIN
  SELECT RAISE(ABORT, 'conflicting authority for overlapping deployment attestation');
END;

CREATE TRIGGER IF NOT EXISTS automation_deployment_attestations_no_version_identity_conflict
BEFORE INSERT ON automation_deployment_attestations
WHEN EXISTS (
  SELECT 1 FROM automation_deployment_attestations existing
  WHERE existing.platform = NEW.platform
    AND existing.service = NEW.service
    AND existing.environment = NEW.environment
    AND existing.version_id = NEW.version_id
    AND (
      existing.source_revision <> NEW.source_revision
      OR existing.source_tree <> NEW.source_tree
      OR existing.worker_version <> NEW.worker_version
      OR existing.runtime_version <> NEW.runtime_version
      OR existing.bundle_sha256 <> NEW.bundle_sha256
      OR existing.modules_digest <> NEW.modules_digest
      OR existing.observed_bindings_digest <> NEW.observed_bindings_digest
      OR existing.build_evidence_sha256 <> NEW.build_evidence_sha256
    )
) BEGIN
  SELECT RAISE(ABORT, 'conflicting immutable Cloudflare version identity');
END;

CREATE TRIGGER IF NOT EXISTS source_event_runtime_provenance_consistent_insert
BEFORE INSERT ON source_event_runtime_provenance
WHEN NOT EXISTS (
  SELECT 1
  FROM source_events source
  JOIN lifecycle_instances lifecycle ON lifecycle.source_event_id = source.source_event_id
  JOIN automation_deployment_attestations attestation ON attestation.deployment_attestation_id = NEW.deployment_attestation_id
  JOIN automation_release_manifests manifest ON manifest.release_manifest_id = attestation.release_manifest_id
  WHERE source.source_event_id = NEW.source_event_id
    AND source.state = 'accepted'
    AND source.family = manifest.family
    AND lifecycle.lifecycle_instance_id = NEW.lifecycle_instance_id
    AND lifecycle.family = manifest.family
    AND source.runtime_version = lifecycle.runtime_version
    AND source.runtime_version = manifest.runtime_version
    AND lifecycle.definition_version = manifest.workflow_version
    AND EXISTS (
      SELECT 1 FROM lifecycle_obligations obligation
      WHERE obligation.lifecycle_instance_id = lifecycle.lifecycle_instance_id
    )
    AND attestation.version_id = NEW.cloudflare_version_id
    AND manifest.workflow_document_sha256 = NEW.workflow_document_sha256_at_bind
    AND manifest.schema_structure_sha256 = NEW.schema_structure_sha256_at_bind
    AND manifest.follow_up_delivery_release = NEW.follow_up_delivery_release_at_bind
    AND manifest.follow_up_assigned_user_delivery = NEW.follow_up_assigned_user_delivery_at_bind
    AND NEW.bound_at >= source.accepted_at
    AND NEW.bound_at >= attestation.attested_at
    AND NEW.bound_at < attestation.expires_at
    AND NEW.retention_until = MIN(
      source.normalized_retention_until,
      lifecycle.retention_until,
      attestation.retention_until,
      manifest.retention_until
    )
) BEGIN
  SELECT RAISE(ABORT, 'source runtime provenance cross-links inconsistent or stale authorities');
END;

CREATE TRIGGER IF NOT EXISTS automation_release_manifests_no_update
BEFORE UPDATE ON automation_release_manifests BEGIN SELECT RAISE(ABORT, 'automation_release_manifests is immutable'); END;
CREATE TRIGGER IF NOT EXISTS automation_release_manifests_no_delete
BEFORE DELETE ON automation_release_manifests
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'automation_release_manifests retained until retention_until');
END;
CREATE TRIGGER IF NOT EXISTS automation_deployment_attestations_no_update
BEFORE UPDATE ON automation_deployment_attestations BEGIN SELECT RAISE(ABORT, 'automation_deployment_attestations is immutable'); END;
CREATE TRIGGER IF NOT EXISTS automation_deployment_attestations_no_delete
BEFORE DELETE ON automation_deployment_attestations
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'automation_deployment_attestations retained until retention_until');
END;
CREATE TRIGGER IF NOT EXISTS source_event_runtime_provenance_no_update
BEFORE UPDATE ON source_event_runtime_provenance BEGIN SELECT RAISE(ABORT, 'source_event_runtime_provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_event_runtime_provenance_no_delete
BEFORE DELETE ON source_event_runtime_provenance
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'source_event_runtime_provenance retained until retention_until');
END;
CREATE TRIGGER IF NOT EXISTS reliability_schema_contracts_no_update
BEFORE UPDATE ON reliability_schema_contracts BEGIN SELECT RAISE(ABORT, 'reliability_schema_contracts is immutable'); END;
CREATE TRIGGER IF NOT EXISTS reliability_schema_contracts_no_delete
BEFORE DELETE ON reliability_schema_contracts BEGIN SELECT RAISE(ABORT, 'reliability_schema_contracts is immutable'); END;

-- Marker inserts are intentionally last. A future migration runner must reject
-- a pre-existing conflicting v2 marker before executing this file and verify
-- the exact sqlite_master structure digest after execution.
INSERT OR IGNORE INTO reliability_schema_versions (version, applied_at, migration_id, description)
VALUES (2, CAST(strftime('%s','now') AS INTEGER) * 1000, 'reliability-spine-v2-deployment-attestation',
        'Authenticated release manifests, deployment attestations, and source-event runtime provenance');
INSERT OR IGNORE INTO reliability_schema_contracts
  (version, migration_id, canonicalization, structure_sha256, expected_objects_json, applied_at)
VALUES (2, 'reliability-spine-v2-deployment-attestation', 'sqlite-master-required-closure.v1',
        'b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6',
        '["index:idx_command_obligation","index:idx_deployment_attestations_latest","index:idx_deployment_attestations_release","index:idx_deployment_attestations_runtime_version","index:idx_enr_contact","index:idx_evidence_access","index:idx_evt_contact","index:idx_evt_engine_flow","index:idx_evt_flow","index:idx_exception_events","index:idx_exceptions_family_queue","index:idx_exceptions_queue","index:idx_lease_events","index:idx_lifecycle_appointment","index:idx_lifecycle_family_state","index:idx_lifecycle_person","index:idx_obligations_due","index:idx_obligations_lease","index:idx_reconciliation_family","index:idx_source_events_provider_event","index:idx_source_events_received","index:idx_source_runtime_provenance_deployment","index:idx_source_transitions","index:idx_steps_due","index:idx_workflow_one_published","table:automation_deployment_attestations","table:automation_events","table:automation_release_manifests","table:command_attempts","table:evidence_access_events","table:exception_events","table:lifecycle_exceptions","table:lifecycle_instances","table:lifecycle_obligations","table:obligation_lease_events","table:provider_receipts","table:reconciliation_runs","table:reliability_schema_contracts","table:reliability_schema_versions","table:reminder_enrollments","table:reminder_steps","table:source_event_runtime_provenance","table:source_event_transitions","table:source_events","table:workflow_versions","trigger:automation_deployment_attestations_consistent_insert","trigger:automation_deployment_attestations_no_delete","trigger:automation_deployment_attestations_no_overlap_conflict","trigger:automation_deployment_attestations_no_update","trigger:automation_deployment_attestations_no_version_identity_conflict","trigger:automation_events_no_delete","trigger:automation_events_no_update","trigger:automation_release_manifests_no_delete","trigger:automation_release_manifests_no_update","trigger:evidence_access_no_delete","trigger:evidence_access_no_update","trigger:exception_events_no_delete","trigger:exception_events_no_update","trigger:lease_events_no_delete","trigger:lease_events_no_update","trigger:reliability_schema_contracts_no_delete","trigger:reliability_schema_contracts_no_update","trigger:source_event_runtime_provenance_consistent_insert","trigger:source_event_runtime_provenance_no_delete","trigger:source_event_runtime_provenance_no_update","trigger:source_events_no_delete","trigger:source_events_no_update","trigger:source_transitions_no_delete","trigger:source_transitions_no_update"]', CAST(strftime('%s','now') AS INTEGER) * 1000);
