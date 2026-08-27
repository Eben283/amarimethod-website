-- DO NOT APPLY. LOCAL-ONLY AUTHORITY-PROMOTION CANDIDATE (phase B of two).
-- This is not a registered Wrangler migration and is not loaded by schema.sql
-- or any runtime entrypoint. Its b289c402... contract describes the local
-- clean-bootstrap candidate, not the historical production-v1 lineage. Phase A
-- is blocked, no production-v2 authority is defined, and this file must remain
-- inert until a live-v1 target is separately designed and reviewed. The final
-- marker/trusted-D1-time ordering below is retained only as candidate evidence.

CREATE TABLE reliability_v2_promotion_gate (
  accepted INTEGER NOT NULL CHECK (accepted = 1)
);

-- Require either the one exact v1 head awaiting promotion or an exact already
-- promoted v2 head. Unknown/future/conflicting markers abort in-transaction.
INSERT INTO reliability_v2_promotion_gate (accepted)
SELECT CASE WHEN (
  (
    (SELECT COUNT(*) FROM reliability_schema_versions) = 1
    AND EXISTS (
      SELECT 1 FROM reliability_schema_versions
      WHERE version = 1 AND applied_at > 0 AND migration_id = 'reliability-spine-v1'
        AND description = 'Durable source events, lifecycle instances, obligations, receipts, reconciliation, and exceptions'
    )
    AND (SELECT COUNT(*) FROM reliability_schema_contracts) = 0
  ) OR (
    (SELECT COUNT(*) FROM reliability_schema_versions) = 2
    AND EXISTS (
      SELECT 1 FROM reliability_schema_versions
      WHERE version = 1 AND applied_at > 0 AND migration_id = 'reliability-spine-v1'
        AND description = 'Durable source events, lifecycle instances, obligations, receipts, reconciliation, and exceptions'
    )
    AND EXISTS (
      SELECT 1 FROM reliability_schema_versions version
      JOIN reliability_schema_contracts contract ON contract.version = version.version
      WHERE version.version = 2 AND version.applied_at = contract.applied_at
        AND version.migration_id = 'reliability-spine-v2-deployment-attestation'
        AND version.description = 'Authenticated release manifests, deployment attestations, and source-event runtime provenance'
        AND contract.migration_id = version.migration_id
        AND contract.canonicalization = 'sqlite-master-required-closure.v1'
        AND contract.structure_sha256 = 'b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6'
    )
  )
) THEN 1 ELSE 0 END;

-- The SQL gate can prove the exact object-name closure. D1 SQL has no SHA-256
-- primitive, so the exact DDL-byte digest is deliberately a mandatory external
-- readback immediately before this promotion and again after it.
DELETE FROM reliability_v2_promotion_gate;
WITH expected(object_key) AS (
  SELECT value FROM json_each(
    '["index:idx_command_obligation","index:idx_deployment_attestations_latest","index:idx_deployment_attestations_release","index:idx_deployment_attestations_runtime_version","index:idx_enr_contact","index:idx_evidence_access","index:idx_evt_contact","index:idx_evt_engine_flow","index:idx_evt_flow","index:idx_exception_events","index:idx_exceptions_family_queue","index:idx_exceptions_queue","index:idx_lease_events","index:idx_lifecycle_appointment","index:idx_lifecycle_family_state","index:idx_lifecycle_person","index:idx_obligations_due","index:idx_obligations_lease","index:idx_reconciliation_family","index:idx_source_events_provider_event","index:idx_source_events_received","index:idx_source_runtime_provenance_deployment","index:idx_source_transitions","index:idx_steps_due","index:idx_workflow_one_published","table:automation_deployment_attestations","table:automation_events","table:automation_release_manifests","table:command_attempts","table:evidence_access_events","table:exception_events","table:lifecycle_exceptions","table:lifecycle_instances","table:lifecycle_obligations","table:obligation_lease_events","table:provider_receipts","table:reconciliation_runs","table:reliability_schema_contracts","table:reliability_schema_versions","table:reminder_enrollments","table:reminder_steps","table:source_event_runtime_provenance","table:source_event_transitions","table:source_events","table:workflow_versions","trigger:automation_deployment_attestations_consistent_insert","trigger:automation_deployment_attestations_no_delete","trigger:automation_deployment_attestations_no_overlap_conflict","trigger:automation_deployment_attestations_no_update","trigger:automation_deployment_attestations_no_version_identity_conflict","trigger:automation_events_no_delete","trigger:automation_events_no_update","trigger:automation_release_manifests_no_delete","trigger:automation_release_manifests_no_update","trigger:evidence_access_no_delete","trigger:evidence_access_no_update","trigger:exception_events_no_delete","trigger:exception_events_no_update","trigger:lease_events_no_delete","trigger:lease_events_no_update","trigger:reliability_schema_contracts_no_delete","trigger:reliability_schema_contracts_no_update","trigger:source_event_runtime_provenance_consistent_insert","trigger:source_event_runtime_provenance_no_delete","trigger:source_event_runtime_provenance_no_update","trigger:source_events_no_delete","trigger:source_events_no_update","trigger:source_transitions_no_delete","trigger:source_transitions_no_update"]'
  )
), required_tables(name) AS (
  SELECT substr(object_key, 7) FROM expected WHERE object_key LIKE 'table:%'
), physical(object_key) AS (
  SELECT type || ':' || name FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_autoindex%'
    AND (
      (type = 'table' AND name IN (SELECT name FROM required_tables))
      OR (type IN ('index','trigger') AND tbl_name IN (SELECT name FROM required_tables))
    )
)
INSERT INTO reliability_v2_promotion_gate (accepted)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM expected) = 69
  AND (SELECT COUNT(*) FROM physical) = 69
  AND NOT EXISTS (SELECT object_key FROM expected EXCEPT SELECT object_key FROM physical)
  AND NOT EXISTS (SELECT object_key FROM physical EXCEPT SELECT object_key FROM expected)
THEN 1 ELSE 0 END;

-- Contract is installed first. On an exact idempotent replay it is retained.
INSERT INTO reliability_schema_contracts
  (version, migration_id, canonicalization, structure_sha256, expected_objects_json, applied_at)
SELECT 2, 'reliability-spine-v2-deployment-attestation', 'sqlite-master-required-closure.v1',
       'b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6',
       '["index:idx_command_obligation","index:idx_deployment_attestations_latest","index:idx_deployment_attestations_release","index:idx_deployment_attestations_runtime_version","index:idx_enr_contact","index:idx_evidence_access","index:idx_evt_contact","index:idx_evt_engine_flow","index:idx_evt_flow","index:idx_exception_events","index:idx_exceptions_family_queue","index:idx_exceptions_queue","index:idx_lease_events","index:idx_lifecycle_appointment","index:idx_lifecycle_family_state","index:idx_lifecycle_person","index:idx_obligations_due","index:idx_obligations_lease","index:idx_reconciliation_family","index:idx_source_events_provider_event","index:idx_source_events_received","index:idx_source_runtime_provenance_deployment","index:idx_source_transitions","index:idx_steps_due","index:idx_workflow_one_published","table:automation_deployment_attestations","table:automation_events","table:automation_release_manifests","table:command_attempts","table:evidence_access_events","table:exception_events","table:lifecycle_exceptions","table:lifecycle_instances","table:lifecycle_obligations","table:obligation_lease_events","table:provider_receipts","table:reconciliation_runs","table:reliability_schema_contracts","table:reliability_schema_versions","table:reminder_enrollments","table:reminder_steps","table:source_event_runtime_provenance","table:source_event_transitions","table:source_events","table:workflow_versions","trigger:automation_deployment_attestations_consistent_insert","trigger:automation_deployment_attestations_no_delete","trigger:automation_deployment_attestations_no_overlap_conflict","trigger:automation_deployment_attestations_no_update","trigger:automation_deployment_attestations_no_version_identity_conflict","trigger:automation_events_no_delete","trigger:automation_events_no_update","trigger:automation_release_manifests_no_delete","trigger:automation_release_manifests_no_update","trigger:evidence_access_no_delete","trigger:evidence_access_no_update","trigger:exception_events_no_delete","trigger:exception_events_no_update","trigger:lease_events_no_delete","trigger:lease_events_no_update","trigger:reliability_schema_contracts_no_delete","trigger:reliability_schema_contracts_no_update","trigger:source_event_runtime_provenance_consistent_insert","trigger:source_event_runtime_provenance_no_delete","trigger:source_event_runtime_provenance_no_update","trigger:source_events_no_delete","trigger:source_events_no_update","trigger:source_transitions_no_delete","trigger:source_transitions_no_update"]',
       CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM reliability_schema_contracts WHERE version = 2);

-- Reject a pre-existing or newly inserted contract unless every authority byte
-- is exact. This runs before the v2 marker.
DELETE FROM reliability_v2_promotion_gate;
INSERT INTO reliability_v2_promotion_gate (accepted)
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM reliability_schema_contracts
WHERE version = 2
  AND migration_id = 'reliability-spine-v2-deployment-attestation'
  AND canonicalization = 'sqlite-master-required-closure.v1'
  AND structure_sha256 = 'b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6'
  AND expected_objects_json = '["index:idx_command_obligation","index:idx_deployment_attestations_latest","index:idx_deployment_attestations_release","index:idx_deployment_attestations_runtime_version","index:idx_enr_contact","index:idx_evidence_access","index:idx_evt_contact","index:idx_evt_engine_flow","index:idx_evt_flow","index:idx_exception_events","index:idx_exceptions_family_queue","index:idx_exceptions_queue","index:idx_lease_events","index:idx_lifecycle_appointment","index:idx_lifecycle_family_state","index:idx_lifecycle_person","index:idx_obligations_due","index:idx_obligations_lease","index:idx_reconciliation_family","index:idx_source_events_provider_event","index:idx_source_events_received","index:idx_source_runtime_provenance_deployment","index:idx_source_transitions","index:idx_steps_due","index:idx_workflow_one_published","table:automation_deployment_attestations","table:automation_events","table:automation_release_manifests","table:command_attempts","table:evidence_access_events","table:exception_events","table:lifecycle_exceptions","table:lifecycle_instances","table:lifecycle_obligations","table:obligation_lease_events","table:provider_receipts","table:reconciliation_runs","table:reliability_schema_contracts","table:reliability_schema_versions","table:reminder_enrollments","table:reminder_steps","table:source_event_runtime_provenance","table:source_event_transitions","table:source_events","table:workflow_versions","trigger:automation_deployment_attestations_consistent_insert","trigger:automation_deployment_attestations_no_delete","trigger:automation_deployment_attestations_no_overlap_conflict","trigger:automation_deployment_attestations_no_update","trigger:automation_deployment_attestations_no_version_identity_conflict","trigger:automation_events_no_delete","trigger:automation_events_no_update","trigger:automation_release_manifests_no_delete","trigger:automation_release_manifests_no_update","trigger:evidence_access_no_delete","trigger:evidence_access_no_update","trigger:exception_events_no_delete","trigger:exception_events_no_update","trigger:lease_events_no_delete","trigger:lease_events_no_update","trigger:reliability_schema_contracts_no_delete","trigger:reliability_schema_contracts_no_update","trigger:source_event_runtime_provenance_consistent_insert","trigger:source_event_runtime_provenance_no_delete","trigger:source_event_runtime_provenance_no_update","trigger:source_events_no_delete","trigger:source_events_no_update","trigger:source_transitions_no_delete","trigger:source_transitions_no_update"]'
  AND applied_at > 0;
DROP TABLE reliability_v2_promotion_gate;

-- FINAL STATEMENT: promote the already-proven physical schema to v2 authority,
-- reusing the contract's trusted D1 clock value. No SQL may follow this marker.
INSERT INTO reliability_schema_versions (version, applied_at, migration_id, description)
SELECT 2, contract.applied_at, contract.migration_id,
       'Authenticated release manifests, deployment attestations, and source-event runtime provenance'
FROM reliability_schema_contracts contract
WHERE contract.version = 2
  AND NOT EXISTS (SELECT 1 FROM reliability_schema_versions WHERE version = 2);
