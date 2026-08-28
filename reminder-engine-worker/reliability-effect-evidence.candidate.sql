-- UNREGISTERED / UNAPPLIED SOURCE-ONLY CANDIDATE. DO NOT APPLY OR REGISTER.
-- Not imported by schema.sql, a migration runner, or any production entrypoint.
-- Existing production-v2 authority is unchanged. Stored links are structural
-- evidence, not authentication or dispatch permission. No cleanup is adopted.

CREATE TABLE follow_up_effect_attempt_bindings (
  command_attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES command_attempts(command_attempt_id),
  source_event_id TEXT NOT NULL REFERENCES source_events(source_event_id),
  lifecycle_instance_id TEXT NOT NULL REFERENCES lifecycle_instances(lifecycle_instance_id),
  obligation_id TEXT NOT NULL REFERENCES lifecycle_obligations(obligation_id),
  workflow_id TEXT NOT NULL CHECK (workflow_id = 'follow-up-session-reminders'),
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  workflow_document_sha256 TEXT NOT NULL CHECK (length(workflow_document_sha256) = 64 AND workflow_document_sha256 NOT GLOB '*[^0-9a-f]*'),
  node_id TEXT NOT NULL,
  acceptance_deployment_attestation_id TEXT NOT NULL REFERENCES automation_deployment_attestations(deployment_attestation_id),
  acceptance_release_manifest_id TEXT NOT NULL REFERENCES automation_release_manifests(release_manifest_id),
  acceptance_compiled_plan_digest TEXT NOT NULL,
  acceptance_handler_registry_digest TEXT NOT NULL,
  executor_deployment_attestation_id TEXT NOT NULL REFERENCES automation_deployment_attestations(deployment_attestation_id),
  executor_release_manifest_id TEXT NOT NULL REFERENCES automation_release_manifests(release_manifest_id),
  executor_compiled_plan_digest TEXT NOT NULL,
  executor_handler_registry_digest TEXT NOT NULL,
  executor_runtime_version TEXT NOT NULL,
  lease_event_id TEXT NOT NULL REFERENCES obligation_lease_events(lease_event_id),
  lease_owner TEXT NOT NULL,
  lease_acquired_at INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL CHECK (lease_expires_at > lease_acquired_at),
  provider TEXT NOT NULL CHECK (provider IN ('gmail','ghl')),
  provider_account_scope TEXT NOT NULL CHECK (length(provider_account_scope) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  retry_class TEXT NOT NULL CHECK (retry_class IN ('provider_idempotent','amari_reconcile','manual_ambiguous')),
  target TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  rendered_copy_sha256 TEXT CHECK (rendered_copy_sha256 IS NULL OR (length(rendered_copy_sha256) = 64 AND rendered_copy_sha256 NOT GLOB '*[^0-9a-f]*')),
  prepared_event_id TEXT NOT NULL UNIQUE,
  prepare_request_sha256 TEXT NOT NULL CHECK (length(prepare_request_sha256) = 64 AND prepare_request_sha256 NOT GLOB '*[^0-9a-f]*'),
  command_created_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),
  retention_until INTEGER NOT NULL CHECK (retention_until > created_at AND retention_until <= created_at + 34560000000)
);

CREATE TABLE follow_up_effect_evidence_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence > 0),
  event_id TEXT NOT NULL UNIQUE,
  command_attempt_id TEXT NOT NULL REFERENCES follow_up_effect_attempt_bindings(command_attempt_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('prepared','observation','receipt')),
  event_digest_sha256 TEXT NOT NULL CHECK (length(event_digest_sha256) = 64 AND event_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
  previous_sequence INTEGER NOT NULL CHECK (previous_sequence >= 0),
  state_before TEXT,
  state_after TEXT,
  occurrence_at INTEGER NOT NULL CHECK (occurrence_at >= 0),
  observed_at INTEGER,
  ingested_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),
  provider TEXT,
  provider_account_scope TEXT,
  provider_reference TEXT,
  provider_receipt_id TEXT UNIQUE,
  proof_level TEXT CHECK (proof_level IS NULL OR proof_level IN ('accepted','delivered','failed','bounced','unknown')),
  evidence_sha256 TEXT CHECK (evidence_sha256 IS NULL OR (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*')),
  detail_sha256 TEXT NOT NULL CHECK (length(detail_sha256) = 64 AND detail_sha256 NOT GLOB '*[^0-9a-f]*'),
  error_code TEXT,
  is_conflict INTEGER NOT NULL DEFAULT 0 CHECK (is_conflict IN (0,1)),
  retention_until INTEGER NOT NULL CHECK (retention_until > ingested_at AND retention_until <= ingested_at + 34560000000),
  CHECK (occurrence_at <= ingested_at),
  CHECK (
    (event_type = 'prepared' AND previous_sequence = 0 AND state_before IS NULL AND state_after = 'prepared'
      AND observed_at IS NULL AND provider IS NULL AND provider_account_scope IS NULL AND provider_reference IS NULL
      AND provider_receipt_id IS NULL AND proof_level IS NULL AND evidence_sha256 IS NULL AND error_code IS NULL AND is_conflict = 0)
    OR (event_type = 'observation' AND previous_sequence > 0 AND state_before IS NOT NULL AND state_after IS NOT NULL
      AND observed_at IS NULL AND provider IS NULL AND provider_account_scope IS NULL
      AND provider_receipt_id IS NULL AND proof_level IS NULL AND evidence_sha256 IS NULL AND is_conflict = 0)
    OR (event_type = 'receipt' AND previous_sequence > 0 AND state_before IS NULL AND state_after IS NULL
      AND observed_at IS NOT NULL AND observed_at = occurrence_at AND observed_at <= ingested_at
      AND provider IS NOT NULL AND provider_account_scope IS NOT NULL AND provider_reference IS NOT NULL
      AND provider_receipt_id IS NOT NULL AND proof_level IS NOT NULL AND evidence_sha256 IS NOT NULL AND error_code IS NULL)
  )
);
CREATE INDEX idx_follow_up_effect_events_attempt ON follow_up_effect_evidence_events(command_attempt_id,sequence);
CREATE INDEX idx_follow_up_effect_events_receipt ON follow_up_effect_evidence_events(provider,provider_account_scope,provider_reference,sequence);

-- REPLACE does not reliably fire DELETE triggers: cover every unique identity
-- before insertion, independently of recursive_triggers. Replays perform no insert.
CREATE TRIGGER follow_up_effect_bindings_no_replace BEFORE INSERT ON follow_up_effect_attempt_bindings
WHEN EXISTS (SELECT 1 FROM follow_up_effect_attempt_bindings b WHERE b.command_attempt_id = NEW.command_attempt_id OR b.prepared_event_id = NEW.prepared_event_id)
BEGIN SELECT RAISE(ABORT,'effect_binding_conflict'); END;
CREATE TRIGGER follow_up_effect_bindings_no_update BEFORE UPDATE ON follow_up_effect_attempt_bindings
BEGIN SELECT RAISE(ABORT,'effect_binding_immutable'); END;
CREATE TRIGGER follow_up_effect_bindings_no_delete BEFORE DELETE ON follow_up_effect_attempt_bindings
BEGIN SELECT RAISE(ABORT,'effect_binding_immutable'); END;
CREATE TRIGGER follow_up_effect_events_no_replace BEFORE INSERT ON follow_up_effect_evidence_events
WHEN EXISTS (SELECT 1 FROM follow_up_effect_evidence_events e WHERE e.event_id = NEW.event_id OR e.sequence = NEW.sequence OR (NEW.provider_receipt_id IS NOT NULL AND e.provider_receipt_id = NEW.provider_receipt_id))
BEGIN SELECT RAISE(ABORT,'effect_event_conflict'); END;
CREATE TRIGGER follow_up_effect_events_no_update BEFORE UPDATE ON follow_up_effect_evidence_events
BEGIN SELECT RAISE(ABORT,'effect_event_immutable'); END;
CREATE TRIGGER follow_up_effect_events_no_delete BEFORE DELETE ON follow_up_effect_evidence_events
BEGIN SELECT RAISE(ABORT,'effect_event_immutable'); END;

CREATE TRIGGER follow_up_effect_binding_guard BEFORE INSERT ON follow_up_effect_attempt_bindings
BEGIN
  SELECT (CASE WHEN NEW.created_at <> (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    THEN RAISE(ABORT,'effect_database_clock_required') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM command_attempts c
    JOIN lifecycle_obligations o ON o.obligation_id = c.obligation_id
    JOIN lifecycle_instances l ON l.lifecycle_instance_id = o.lifecycle_instance_id
    JOIN source_events s ON s.source_event_id = l.source_event_id
    JOIN source_event_runtime_provenance p ON p.source_event_id = s.source_event_id AND p.lifecycle_instance_id = l.lifecycle_instance_id
    JOIN automation_deployment_attestations a ON a.deployment_attestation_id = p.deployment_attestation_id
    JOIN automation_release_manifests am ON am.release_manifest_id = a.release_manifest_id
    JOIN automation_deployment_attestations x ON x.deployment_attestation_id = NEW.executor_deployment_attestation_id
    JOIN automation_release_manifests xm ON xm.release_manifest_id = x.release_manifest_id
    JOIN obligation_lease_events le ON le.lease_event_id = NEW.lease_event_id AND le.obligation_id = o.obligation_id
    JOIN workflow_versions w ON w.workflow_id = NEW.workflow_id AND w.version = NEW.workflow_version
    WHERE c.command_attempt_id = NEW.command_attempt_id AND c.obligation_id = NEW.obligation_id
      AND c.idempotency_key = NEW.idempotency_key AND c.attempt_number = NEW.attempt_number
      AND c.retry_class = NEW.retry_class AND c.target = NEW.target AND c.request_sha256 = NEW.request_sha256
      AND c.rendered_copy_sha256 IS NEW.rendered_copy_sha256 AND c.retention_until = NEW.retention_until
      AND c.state = 'prepared' AND c.provider_reference IS NULL AND c.error_code IS NULL
      AND c.created_at = NEW.command_created_at AND c.created_at <= NEW.created_at AND c.updated_at = c.created_at
      AND s.source_event_id = NEW.source_event_id AND l.lifecycle_instance_id = NEW.lifecycle_instance_id
      AND s.state = 'accepted' AND s.authentication_result = 'authenticated' AND s.normalization_state = 'normalized'
      AND s.family = NEW.workflow_id AND l.family = NEW.workflow_id AND o.family = NEW.workflow_id
      AND l.state = 'active' AND l.definition_version = NEW.workflow_version AND l.runtime_version = s.runtime_version
      AND o.obligation_key = NEW.node_id AND o.closer = 'provider_receipt'
      AND s.accepted_at <= NEW.created_at AND s.received_at <= s.accepted_at AND l.created_at <= NEW.created_at
      AND a.deployment_attestation_id = NEW.acceptance_deployment_attestation_id
      AND a.release_manifest_id = NEW.acceptance_release_manifest_id
      AND am.compiled_plan_digest = NEW.acceptance_compiled_plan_digest AND am.handler_registry_digest = NEW.acceptance_handler_registry_digest
      AND x.release_manifest_id = NEW.executor_release_manifest_id
      AND xm.compiled_plan_digest = NEW.executor_compiled_plan_digest AND xm.handler_registry_digest = NEW.executor_handler_registry_digest
      AND am.family = NEW.workflow_id AND xm.family = NEW.workflow_id
      AND am.workflow_id = NEW.workflow_id AND xm.workflow_id = NEW.workflow_id
      AND am.workflow_version = NEW.workflow_version AND xm.workflow_version = NEW.workflow_version
      AND am.workflow_document_sha256 = NEW.workflow_document_sha256 AND xm.workflow_document_sha256 = NEW.workflow_document_sha256
      AND a.workflow_document_sha256 = NEW.workflow_document_sha256 AND x.workflow_document_sha256 = NEW.workflow_document_sha256
      AND p.workflow_document_sha256_at_bind = NEW.workflow_document_sha256
      AND a.runtime_version = s.runtime_version AND am.runtime_version = s.runtime_version
      AND x.runtime_version = NEW.executor_runtime_version AND xm.runtime_version = NEW.executor_runtime_version
      AND p.cloudflare_version_id = a.version_id AND p.schema_structure_sha256_at_bind = a.schema_structure_sha256
      AND p.bound_at >= a.attested_at AND p.bound_at < a.expires_at AND p.bound_at >= s.accepted_at AND p.bound_at <= NEW.created_at
      AND x.attested_at <= NEW.created_at AND x.recorded_at <= NEW.created_at AND NEW.created_at < x.expires_at
      AND a.follow_up_delivery_release = 'approved' AND x.follow_up_delivery_release = 'approved'
      AND a.follow_up_assigned_user_delivery = 'approved' AND x.follow_up_assigned_user_delivery = 'approved'
      AND o.state = 'leased' AND o.lease_owner = NEW.lease_owner AND o.lease_acquired_at = NEW.lease_acquired_at AND o.lease_expires_at = NEW.lease_expires_at
      AND le.new_owner = NEW.lease_owner AND le.lease_acquired_at = NEW.lease_acquired_at AND le.lease_expires_at = NEW.lease_expires_at
      AND NEW.lease_acquired_at <= NEW.created_at AND NEW.created_at < NEW.lease_expires_at
      AND NEW.retention_until <= MIN(s.normalized_retention_until,l.retention_until,o.retention_until,p.retention_until,a.retention_until,am.retention_until,x.retention_until,xm.retention_until,le.retention_until)
      AND w.state = 'published' AND json_valid(w.document)
      AND json_extract(w.document,'$.id') = NEW.workflow_id AND json_extract(w.document,'$.version') = NEW.workflow_version
      AND (SELECT COUNT(*) FROM json_each(w.document,'$.nodes') n WHERE json_extract(n.value,'$.id') = NEW.node_id) = 1
      AND EXISTS (SELECT 1 FROM json_each(w.document,'$.nodes') n WHERE json_extract(n.value,'$.id') = NEW.node_id
        AND json_extract(n.value,'$.action.type') IN ('email','internal_email','sms','internal_sms')
        AND o.kind = json_extract(n.value,'$.message.audience') || '_' || json_extract(n.value,'$.message.channel')
        AND NEW.provider = (CASE json_extract(n.value,'$.message.channel') WHEN 'email' THEN 'gmail' WHEN 'sms' THEN 'ghl' ELSE '' END))
  ) THEN RAISE(ABORT,'effect_binding_invalid') END);
END;

CREATE TRIGGER follow_up_effect_event_guard BEFORE INSERT ON follow_up_effect_evidence_events
BEGIN
  SELECT (CASE WHEN NEW.ingested_at <> (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    THEN RAISE(ABORT,'effect_database_clock_required') END);
  SELECT (CASE WHEN NEW.previous_sequence <> COALESCE((SELECT MAX(sequence) FROM follow_up_effect_evidence_events WHERE command_attempt_id = NEW.command_attempt_id),0)
    THEN RAISE(ABORT,'effect_stale_sequence') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM follow_up_effect_attempt_bindings b
    JOIN command_attempts c ON c.command_attempt_id = b.command_attempt_id
    JOIN lifecycle_obligations o ON o.obligation_id = b.obligation_id
    JOIN lifecycle_instances l ON l.lifecycle_instance_id = b.lifecycle_instance_id
    JOIN source_events s ON s.source_event_id = b.source_event_id
    JOIN obligation_lease_events le ON le.lease_event_id = b.lease_event_id
    JOIN source_event_runtime_provenance p ON p.source_event_id = s.source_event_id
    JOIN automation_deployment_attestations a ON a.deployment_attestation_id = b.acceptance_deployment_attestation_id
    JOIN automation_deployment_attestations x ON x.deployment_attestation_id = b.executor_deployment_attestation_id
    JOIN automation_release_manifests am ON am.release_manifest_id = b.acceptance_release_manifest_id
    JOIN automation_release_manifests xm ON xm.release_manifest_id = b.executor_release_manifest_id
    WHERE b.command_attempt_id = NEW.command_attempt_id
      AND c.obligation_id = b.obligation_id AND c.idempotency_key = b.idempotency_key AND c.attempt_number = b.attempt_number
      AND c.retry_class = b.retry_class AND c.target = b.target AND c.request_sha256 = b.request_sha256 AND c.rendered_copy_sha256 IS b.rendered_copy_sha256
      AND c.created_at = b.command_created_at
      AND o.lifecycle_instance_id = l.lifecycle_instance_id AND l.source_event_id = s.source_event_id
      AND o.family = b.workflow_id AND l.family = b.workflow_id AND s.family = b.workflow_id
      AND o.obligation_key = b.node_id AND o.closer = 'provider_receipt'
      AND p.lifecycle_instance_id = l.lifecycle_instance_id AND p.deployment_attestation_id = a.deployment_attestation_id
      AND p.workflow_document_sha256_at_bind = b.workflow_document_sha256
      AND a.release_manifest_id = am.release_manifest_id AND x.release_manifest_id = xm.release_manifest_id
      AND am.compiled_plan_digest = b.acceptance_compiled_plan_digest AND am.handler_registry_digest = b.acceptance_handler_registry_digest
      AND xm.compiled_plan_digest = b.executor_compiled_plan_digest AND xm.handler_registry_digest = b.executor_handler_registry_digest
      AND am.workflow_document_sha256 = b.workflow_document_sha256 AND xm.workflow_document_sha256 = b.workflow_document_sha256
      AND xm.runtime_version = b.executor_runtime_version AND x.runtime_version = b.executor_runtime_version
      AND le.obligation_id = b.obligation_id AND le.new_owner = b.lease_owner AND le.lease_acquired_at = b.lease_acquired_at AND le.lease_expires_at = b.lease_expires_at
      AND NEW.ingested_at >= b.created_at AND NEW.retention_until = b.retention_until
      AND NEW.retention_until <= MIN(c.retention_until,s.normalized_retention_until,l.retention_until,o.retention_until,p.retention_until,a.retention_until,am.retention_until,x.retention_until,xm.retention_until,le.retention_until)
  ) THEN RAISE(ABORT,'effect_binding_invalid') END);
  SELECT (CASE WHEN NEW.event_type <> 'prepared' AND NOT EXISTS (
    SELECT 1 FROM command_attempts c JOIN follow_up_effect_attempt_bindings b USING(command_attempt_id)
    WHERE c.command_attempt_id = NEW.command_attempt_id
      AND c.state = (SELECT p.state_after FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = c.command_attempt_id
        AND p.event_type IN ('prepared','observation') ORDER BY p.sequence DESC LIMIT 1)
      AND c.provider_reference IS (SELECT p.provider_reference FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = c.command_attempt_id
        AND p.event_type = 'observation' AND p.provider_reference IS NOT NULL ORDER BY p.sequence DESC LIMIT 1)
      AND c.error_code IS (SELECT p.error_code FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = c.command_attempt_id
        AND p.event_type = 'observation' ORDER BY p.sequence DESC LIMIT 1)
      AND c.updated_at = COALESCE((SELECT p.ingested_at FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = c.command_attempt_id
        AND p.event_type = 'observation' ORDER BY p.sequence DESC LIMIT 1),b.command_created_at)
  ) THEN RAISE(ABORT,'effect_projection_stale') END);
  SELECT (CASE WHEN NEW.event_type = 'prepared' AND NOT EXISTS (
    SELECT 1 FROM follow_up_effect_attempt_bindings b JOIN command_attempts c USING(command_attempt_id)
    WHERE b.command_attempt_id = NEW.command_attempt_id AND b.prepared_event_id = NEW.event_id
      AND b.prepare_request_sha256 = NEW.event_digest_sha256 AND c.state = 'prepared'
  ) THEN RAISE(ABORT,'effect_prepared_event_invalid') END);
  SELECT (CASE WHEN NEW.event_type <> 'prepared' AND NOT EXISTS (
    SELECT 1 FROM follow_up_effect_evidence_events e WHERE e.command_attempt_id = NEW.command_attempt_id AND e.event_type = 'prepared'
  ) THEN RAISE(ABORT,'effect_prepared_event_missing') END);
  SELECT (CASE WHEN NEW.event_type = 'observation' AND (
    NOT ((NEW.state_before = 'prepared' AND NEW.state_after IN ('submitted','ambiguous','failed_retryable','failed_terminal'))
      OR (NEW.state_before = 'submitted' AND NEW.state_after IN ('ambiguous','failed_retryable','failed_terminal'))
      OR (NEW.state_before = 'failed_retryable' AND NEW.state_after IN ('ambiguous','failed_terminal'))
      OR (NEW.state_before = 'ambiguous' AND NEW.state_after = 'failed_terminal'))
    OR NOT EXISTS (SELECT 1 FROM command_attempts c WHERE c.command_attempt_id = NEW.command_attempt_id AND c.state = NEW.state_before
      AND (c.provider_reference IS NULL OR NEW.provider_reference IS NULL OR c.provider_reference = NEW.provider_reference))
  ) THEN RAISE(ABORT,'effect_projection_stale') END);
  SELECT (CASE WHEN NEW.event_type = 'observation' AND NEW.state_after = 'submitted' AND NOT EXISTS (
    SELECT 1 FROM follow_up_effect_attempt_bindings b
    JOIN lifecycle_obligations o ON o.obligation_id = b.obligation_id
    JOIN lifecycle_instances l ON l.lifecycle_instance_id = b.lifecycle_instance_id
    JOIN automation_deployment_attestations x ON x.deployment_attestation_id = b.executor_deployment_attestation_id
    WHERE b.command_attempt_id = NEW.command_attempt_id AND l.state = 'active'
      AND o.state = 'leased' AND o.lease_owner = b.lease_owner AND o.lease_acquired_at = b.lease_acquired_at AND o.lease_expires_at = b.lease_expires_at
      AND b.lease_acquired_at <= NEW.ingested_at AND NEW.ingested_at < b.lease_expires_at AND NEW.ingested_at < x.expires_at
  ) THEN RAISE(ABORT,'effect_live_fence_missing') END);
  SELECT (CASE WHEN NEW.event_type = 'receipt' AND NOT EXISTS (
    SELECT 1 FROM follow_up_effect_attempt_bindings b JOIN command_attempts c USING(command_attempt_id)
    WHERE b.command_attempt_id = NEW.command_attempt_id AND b.provider = NEW.provider AND b.provider_account_scope = NEW.provider_account_scope
      AND c.provider_reference = NEW.provider_reference
      AND EXISTS (SELECT 1 FROM follow_up_effect_evidence_events sent WHERE sent.command_attempt_id = b.command_attempt_id
        AND sent.event_type = 'observation' AND sent.state_after = 'submitted' AND sent.provider_reference = NEW.provider_reference)
  ) THEN RAISE(ABORT,'effect_receipt_unlinked') END);
  SELECT (CASE WHEN NEW.event_type = 'receipt' AND EXISTS (
    SELECT 1 FROM provider_receipts r WHERE r.provider = NEW.provider AND r.provider_reference = NEW.provider_reference AND r.command_attempt_id <> NEW.command_attempt_id
  ) THEN RAISE(ABORT,'effect_receipt_ownership_conflict') END);
  SELECT (CASE WHEN NEW.event_type = 'receipt' AND EXISTS (
    SELECT 1 FROM provider_receipts r WHERE r.provider_receipt_id = NEW.provider_receipt_id
      OR (r.provider = NEW.provider AND r.provider_reference = NEW.provider_reference AND r.proof_level = NEW.proof_level AND r.evidence_sha256 = NEW.evidence_sha256)
  ) THEN RAISE(ABORT,'effect_receipt_identity_conflict') END);
  SELECT (CASE WHEN NEW.event_type = 'receipt' AND NEW.is_conflict <> (CASE WHEN EXISTS (
    SELECT 1 FROM provider_receipts r WHERE r.provider = NEW.provider AND r.provider_reference = NEW.provider_reference
      AND ((r.proof_level = NEW.proof_level AND r.evidence_sha256 <> NEW.evidence_sha256)
        OR (r.proof_level = 'delivered' AND NEW.proof_level IN ('failed','bounced'))
        OR (NEW.proof_level = 'delivered' AND r.proof_level IN ('failed','bounced')))
  ) THEN 1 ELSE 0 END) THEN RAISE(ABORT,'effect_receipt_conflict_flag_invalid') END);
END;

-- Trigger-side assertions abort the entire D1 batch, including its event. A
-- JavaScript post-read cannot undo a previously committed projection.
CREATE TRIGGER follow_up_effect_event_sequence_guard AFTER INSERT ON follow_up_effect_evidence_events
WHEN EXISTS (SELECT 1 FROM follow_up_effect_evidence_events e WHERE e.sequence <> NEW.sequence AND e.sequence >= NEW.sequence)
BEGIN SELECT RAISE(ABORT,'effect_nonmonotonic_sequence'); END;
CREATE TRIGGER follow_up_effect_observation_projection AFTER INSERT ON follow_up_effect_evidence_events
WHEN NEW.event_type = 'observation'
BEGIN
  UPDATE command_attempts SET state = NEW.state_after,
    provider_reference = COALESCE(NEW.provider_reference,provider_reference), error_code = NEW.error_code, updated_at = NEW.ingested_at
  WHERE command_attempt_id = NEW.command_attempt_id AND state = NEW.state_before;
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT,'effect_projection_stale') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM command_attempts c JOIN follow_up_effect_attempt_bindings b USING(command_attempt_id)
    WHERE c.command_attempt_id = NEW.command_attempt_id AND c.state = NEW.state_after AND c.error_code IS NEW.error_code AND c.updated_at = NEW.ingested_at
      AND c.obligation_id = b.obligation_id AND c.idempotency_key = b.idempotency_key AND c.attempt_number = b.attempt_number
      AND c.retry_class = b.retry_class AND c.target = b.target AND c.request_sha256 = b.request_sha256
      AND c.rendered_copy_sha256 IS b.rendered_copy_sha256 AND c.created_at = b.command_created_at AND c.retention_until = b.retention_until
      AND c.provider_reference IS (SELECT p.provider_reference FROM follow_up_effect_evidence_events p
        WHERE p.command_attempt_id = c.command_attempt_id AND p.event_type = 'observation' AND p.provider_reference IS NOT NULL ORDER BY p.sequence DESC LIMIT 1)
  ) THEN RAISE(ABORT,'effect_projection_stale') END);
END;
CREATE TRIGGER follow_up_effect_receipt_projection AFTER INSERT ON follow_up_effect_evidence_events
WHEN NEW.event_type = 'receipt'
BEGIN
  INSERT INTO provider_receipts(provider_receipt_id,command_attempt_id,provider,provider_reference,proof_level,evidence_sha256,observed_at,retention_until,created_at)
  VALUES(NEW.provider_receipt_id,NEW.command_attempt_id,NEW.provider,NEW.provider_reference,NEW.proof_level,NEW.evidence_sha256,NEW.observed_at,NEW.retention_until,NEW.ingested_at);
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT,'effect_receipt_projection_failed') END);
  SELECT (CASE WHEN NOT EXISTS (SELECT 1 FROM provider_receipts r WHERE r.provider_receipt_id = NEW.provider_receipt_id
    AND r.command_attempt_id = NEW.command_attempt_id AND r.provider = NEW.provider AND r.provider_reference = NEW.provider_reference
    AND r.proof_level = NEW.proof_level AND r.evidence_sha256 = NEW.evidence_sha256 AND r.observed_at = NEW.observed_at
    AND r.retention_until = NEW.retention_until AND r.created_at = NEW.ingested_at)
    THEN RAISE(ABORT,'effect_receipt_projection_failed') END);
END;
