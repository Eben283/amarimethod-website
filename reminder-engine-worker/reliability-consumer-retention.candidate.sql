-- UNREGISTERED / UNAPPLIED SOURCE-ONLY CANDIDATE. No runtime or purge adoption.
-- Two append-only observer tables, not business obligations or dispatch leases.
-- Hashes are computed in JavaScript; they are structural content identities,
-- not authenticated provenance or an external restore witness.

CREATE TABLE follow_up_consumer_checkpoints (
  checkpoint_id TEXT PRIMARY KEY NOT NULL,
  consumer_key TEXT NOT NULL CHECK(length(consumer_key) BETWEEN 1 AND 200),
  generation INTEGER NOT NULL CHECK(generation > 0),
  previous_checkpoint_id TEXT REFERENCES follow_up_consumer_checkpoints(checkpoint_id),
  previous_checkpoint_digest TEXT,
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),
  operation_digest TEXT NOT NULL CHECK(length(operation_digest)=64 AND operation_digest NOT GLOB '*[^0-9a-f]*'),
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('inputs','journal')),
  operation_page INTEGER NOT NULL CHECK(operation_page BETWEEN 0 AND 19),
  operation_complete INTEGER NOT NULL CHECK(operation_complete IN (0,1)),
  prefix_sequence INTEGER NOT NULL CHECK(prefix_sequence >= 0),
  prefix_event_id_sha256 TEXT,
  prefix_event_digest TEXT,
  window_high_sequence INTEGER NOT NULL CHECK(window_high_sequence >= prefix_sequence),
  window_event_id_sha256 TEXT,
  window_event_digest TEXT,
  window_complete INTEGER NOT NULL CHECK(window_complete IN (0,1) AND window_complete=(prefix_sequence=window_high_sequence)),
  prefix_digest TEXT NOT NULL CHECK(length(prefix_digest)=64 AND prefix_digest NOT GLOB '*[^0-9a-f]*'),
  evidence_valid_until INTEGER,
  cumulative_member_count INTEGER NOT NULL CHECK(cumulative_member_count >= 0),
  payload_json TEXT NOT NULL CHECK(length(CAST(payload_json AS BLOB))<=1500000 AND json_valid(payload_json)),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),
  checkpoint_digest TEXT NOT NULL CHECK(length(checkpoint_digest)=64 AND checkpoint_digest NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL DEFAULT(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),
  UNIQUE(consumer_key,generation), UNIQUE(consumer_key,operation_id,operation_page), UNIQUE(previous_checkpoint_id),
  CHECK((prefix_sequence=0 AND prefix_event_id_sha256 IS NULL AND prefix_event_digest IS NULL)
    OR (prefix_sequence>0 AND prefix_event_id_sha256 IS NOT NULL AND prefix_event_digest IS NOT NULL
      AND length(prefix_event_id_sha256)=64 AND length(prefix_event_digest)=64
      AND prefix_event_id_sha256 NOT GLOB '*[^0-9a-f]*' AND prefix_event_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK((window_high_sequence=0 AND window_event_id_sha256 IS NULL AND window_event_digest IS NULL)
    OR (window_high_sequence>0 AND window_event_id_sha256 IS NOT NULL AND window_event_digest IS NOT NULL
      AND length(window_event_id_sha256)=64 AND length(window_event_digest)=64
      AND window_event_id_sha256 NOT GLOB '*[^0-9a-f]*' AND window_event_digest NOT GLOB '*[^0-9a-f]*')),
  CHECK(evidence_valid_until IS NULL OR evidence_valid_until>0)
);
CREATE INDEX idx_follow_up_consumer_operation ON follow_up_consumer_checkpoints(consumer_key,operation_id,operation_page);

CREATE TABLE follow_up_consumer_retained_reasons (
  checkpoint_id TEXT NOT NULL REFERENCES follow_up_consumer_checkpoints(checkpoint_id),
  member_index INTEGER NOT NULL CHECK(member_index>=0),
  consumer_key TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>0),
  candidate_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('source','lifecycle','obligation','exception','evidence','anomaly')),
  identity TEXT NOT NULL CHECK(length(identity)=67 AND substr(identity,1,3)='id_' AND substr(identity,4) NOT GLOB '*[^0-9a-f]*'),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('new_source','unresolved_lifecycle','unresolved_obligation','open_exception','carry_forward',
    'late_linked_evidence','terminal_anomaly','retention_expired','missing_parent','unsupported_terminal_state','candidate_missing',
    'sequenced_evidence','journal_linked_parent','conflicting_receipt_evidence')),
  PRIMARY KEY(checkpoint_id,member_index), UNIQUE(checkpoint_id,candidate_id,reason_code),
  CHECK(candidate_id=kind||':'||identity)
);
CREATE INDEX idx_follow_up_consumer_candidates ON follow_up_consumer_retained_reasons(consumer_key,candidate_id,generation);
CREATE INDEX idx_follow_up_consumer_members ON follow_up_consumer_retained_reasons(consumer_key,generation);

-- Separately versioned checkpoint-aware read projection, never a rewrite of
-- the frozen root-zero reader. Raw references below are transient read proofs;
-- they are NOT persisted in either observer table or exposed in API results.
CREATE VIEW follow_up_consumer_journal_v1 AS
WITH checked AS (
  SELECT e.*,b.source_event_id,b.lifecycle_instance_id,b.obligation_id,
  (CASE WHEN
    c.command_attempt_id=b.command_attempt_id AND c.obligation_id=b.obligation_id
    AND c.idempotency_key=b.idempotency_key AND c.attempt_number=b.attempt_number AND c.retry_class=b.retry_class
    AND c.target=b.target AND c.request_sha256=b.request_sha256 AND c.rendered_copy_sha256 IS b.rendered_copy_sha256
    AND c.retention_until=b.retention_until AND c.created_at=b.command_created_at
    AND c.state=(SELECT p.state_after FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id=b.command_attempt_id
      AND p.event_type IN ('prepared','observation') ORDER BY p.sequence DESC LIMIT 1)
    AND c.provider_reference IS (SELECT p.provider_reference FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id=b.command_attempt_id
      AND p.event_type='observation' AND p.provider_reference IS NOT NULL ORDER BY p.sequence DESC LIMIT 1)
    AND c.error_code IS (SELECT p.error_code FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id=b.command_attempt_id
      AND p.event_type='observation' ORDER BY p.sequence DESC LIMIT 1)
    AND c.updated_at=COALESCE((SELECT p.ingested_at FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id=b.command_attempt_id
      AND p.event_type='observation' ORDER BY p.sequence DESC LIMIT 1),b.command_created_at)
    AND e.retention_until=b.retention_until AND b.retention_until>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    AND EXISTS(SELECT 1 FROM lifecycle_obligations o JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id
      JOIN source_events s ON s.source_event_id=l.source_event_id
      WHERE o.obligation_id=b.obligation_id AND l.lifecycle_instance_id=b.lifecycle_instance_id AND s.source_event_id=b.source_event_id
        AND o.family=b.workflow_id AND l.family=b.workflow_id AND s.family=b.workflow_id AND o.obligation_key=b.node_id
        AND b.retention_until<=MIN(o.retention_until,l.retention_until,s.normalized_retention_until))
    AND EXISTS(SELECT 1 FROM source_event_runtime_provenance p
      JOIN obligation_lease_events le ON le.lease_event_id=b.lease_event_id
      JOIN automation_deployment_attestations a ON a.deployment_attestation_id=b.acceptance_deployment_attestation_id
      JOIN automation_deployment_attestations x ON x.deployment_attestation_id=b.executor_deployment_attestation_id
      JOIN automation_release_manifests am ON am.release_manifest_id=b.acceptance_release_manifest_id
      JOIN automation_release_manifests xm ON xm.release_manifest_id=b.executor_release_manifest_id
      WHERE p.source_event_id=b.source_event_id AND p.lifecycle_instance_id=b.lifecycle_instance_id
        AND p.deployment_attestation_id=a.deployment_attestation_id AND p.workflow_document_sha256_at_bind=b.workflow_document_sha256
        AND le.obligation_id=b.obligation_id AND le.new_owner=b.lease_owner AND le.lease_acquired_at=b.lease_acquired_at AND le.lease_expires_at=b.lease_expires_at
        AND a.release_manifest_id=am.release_manifest_id AND x.release_manifest_id=xm.release_manifest_id
        AND am.compiled_plan_digest=b.acceptance_compiled_plan_digest AND am.handler_registry_digest=b.acceptance_handler_registry_digest
        AND xm.compiled_plan_digest=b.executor_compiled_plan_digest AND xm.handler_registry_digest=b.executor_handler_registry_digest
        AND am.workflow_document_sha256=b.workflow_document_sha256 AND xm.workflow_document_sha256=b.workflow_document_sha256
        AND b.retention_until<=MIN(p.retention_until,le.retention_until,a.retention_until,x.retention_until,am.retention_until,xm.retention_until))
    AND e.previous_sequence=COALESCE((SELECT MAX(p.sequence) FROM follow_up_effect_evidence_events p
      WHERE p.command_attempt_id=e.command_attempt_id AND p.sequence<e.sequence),0)
    AND (
      (e.event_type='prepared' AND e.previous_sequence=0 AND e.event_id=b.prepared_event_id AND e.event_digest_sha256=b.prepare_request_sha256)
      OR (e.event_type='observation' AND e.previous_sequence>0
        AND e.state_before=(SELECT p.state_after FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id=e.command_attempt_id
          AND p.sequence<e.sequence AND p.event_type IN ('prepared','observation') ORDER BY p.sequence DESC LIMIT 1)
        AND ((e.state_before='prepared' AND e.state_after IN ('submitted','ambiguous','failed_retryable','failed_terminal'))
          OR (e.state_before='submitted' AND e.state_after IN ('ambiguous','failed_retryable','failed_terminal'))
          OR (e.state_before='failed_retryable' AND e.state_after IN ('ambiguous','failed_terminal')) OR (e.state_before='ambiguous' AND e.state_after='failed_terminal'))
        AND NOT EXISTS(SELECT 1 FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id=e.command_attempt_id
          AND p.sequence<e.sequence AND p.event_type='observation' AND p.provider_reference IS NOT NULL
          AND e.provider_reference IS NOT NULL AND e.provider_reference<>p.provider_reference))
      OR (e.event_type='receipt' AND e.previous_sequence>0 AND e.provider=b.provider AND e.provider_account_scope=b.provider_account_scope
        AND EXISTS(SELECT 1 FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id=e.command_attempt_id
          AND p.sequence<e.sequence AND p.event_type='observation' AND p.state_after='submitted' AND p.provider_reference=e.provider_reference)
        AND EXISTS(SELECT 1 FROM provider_receipts r WHERE r.provider_receipt_id=e.provider_receipt_id
          AND r.command_attempt_id=e.command_attempt_id AND r.provider=e.provider AND r.provider_reference=e.provider_reference
          AND r.proof_level=e.proof_level AND r.evidence_sha256=e.evidence_sha256 AND r.observed_at=e.observed_at
          AND r.created_at=e.ingested_at AND r.retention_until=e.retention_until)
        AND NOT EXISTS(SELECT 1 FROM provider_receipts r WHERE r.provider=e.provider AND r.provider_reference=e.provider_reference AND r.command_attempt_id<>e.command_attempt_id)
        AND (e.is_conflict=1 OR NOT EXISTS(SELECT 1 FROM follow_up_effect_evidence_events p WHERE p.sequence<e.sequence
          AND p.event_type='receipt' AND p.provider=e.provider AND p.provider_reference=e.provider_reference
          AND ((p.proof_level=e.proof_level AND p.evidence_sha256<>e.evidence_sha256)
            OR (p.proof_level='delivered' AND e.proof_level IN ('failed','bounced'))
            OR (e.proof_level='delivered' AND p.proof_level IN ('failed','bounced'))))))
    ) THEN 1 ELSE 0 END) valid
  FROM follow_up_effect_evidence_events e LEFT JOIN follow_up_effect_attempt_bindings b USING(command_attempt_id)
  LEFT JOIN command_attempts c ON c.command_attempt_id=b.command_attempt_id
)
SELECT sequence,event_id,event_digest_sha256,retention_until,valid,
  -- D1 allows 32 function arguments. json_set preserves explicit null fields;
  -- json_patch would delete them and is therefore not interchangeable here.
  json_set(json_object('sequence',sequence,'previous_sequence',previous_sequence,'event_id',event_id,'command_attempt_id',command_attempt_id,
    'source_event_id',source_event_id,'lifecycle_instance_id',lifecycle_instance_id,'obligation_id',obligation_id,
    'event_type',event_type,'event_digest_sha256',event_digest_sha256,'state_before',state_before,'state_after',state_after,
    'occurrence_at',occurrence_at,'observed_at',observed_at,'ingested_at',ingested_at,'provider',provider),
    '$.provider_account_scope',provider_account_scope,'$.provider_reference',provider_reference,'$.provider_receipt_id',provider_receipt_id,
    '$.proof_level',proof_level,'$.evidence_sha256',evidence_sha256,'$.detail_sha256',detail_sha256,'$.error_code',error_code,
    '$.is_conflict',is_conflict,'$.retention_until',retention_until) row_json FROM checked;

CREATE TRIGGER follow_up_consumer_checkpoint_no_replace BEFORE INSERT ON follow_up_consumer_checkpoints
WHEN EXISTS(SELECT 1 FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.checkpoint_id
  OR (p.consumer_key=NEW.consumer_key AND (p.generation=NEW.generation OR (p.operation_id=NEW.operation_id AND p.operation_page=NEW.operation_page)))
  OR (NEW.previous_checkpoint_id IS NOT NULL AND p.previous_checkpoint_id=NEW.previous_checkpoint_id))
BEGIN SELECT RAISE(ABORT,'consumer_checkpoint_conflict'); END;
CREATE TRIGGER follow_up_consumer_checkpoint_guard BEFORE INSERT ON follow_up_consumer_checkpoints
BEGIN
  SELECT (CASE WHEN NEW.created_at<>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    THEN RAISE(ABORT,'consumer_database_clock_required') END);
  SELECT (CASE WHEN NEW.generation<>COALESCE((SELECT MAX(p.generation) FROM follow_up_consumer_checkpoints p WHERE p.consumer_key=NEW.consumer_key),0)+1
    OR NEW.previous_checkpoint_id IS NOT (SELECT p.checkpoint_id FROM follow_up_consumer_checkpoints p WHERE p.consumer_key=NEW.consumer_key ORDER BY p.generation DESC LIMIT 1)
    OR NEW.previous_checkpoint_digest IS NOT (SELECT p.checkpoint_digest FROM follow_up_consumer_checkpoints p WHERE p.consumer_key=NEW.consumer_key ORDER BY p.generation DESC LIMIT 1)
    THEN RAISE(ABORT,'consumer_checkpoint_stale') END);
  SELECT (CASE WHEN NEW.generation<>(SELECT COUNT(*)+1 FROM follow_up_consumer_checkpoints p WHERE p.consumer_key=NEW.consumer_key)
    OR COALESCE((SELECT p.cumulative_member_count FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id),0)
      <>(SELECT COUNT(*) FROM follow_up_consumer_retained_reasons r WHERE r.consumer_key=NEW.consumer_key)
    THEN RAISE(ABORT,'consumer_retention_gap') END);
  -- Detect a mixed ancestor restore or same-count membership substitution.
  -- A coherent rollback of BOTH streams still needs an external witness.
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM follow_up_consumer_checkpoints p
    LEFT JOIN follow_up_consumer_checkpoints q ON q.consumer_key=p.consumer_key AND q.generation=p.generation-1
    WHERE p.consumer_key=NEW.consumer_key AND (
      (p.generation=1 AND (p.previous_checkpoint_id IS NOT NULL OR p.previous_checkpoint_digest IS NOT NULL))
      OR (p.generation>1 AND (q.checkpoint_id IS NULL OR p.previous_checkpoint_id IS NOT q.checkpoint_id OR p.previous_checkpoint_digest IS NOT q.checkpoint_digest))
      OR p.cumulative_member_count<>COALESCE(q.cumulative_member_count,0)+json_array_length(p.payload_json,'$.members')
      OR (SELECT COUNT(*) FROM follow_up_consumer_retained_reasons r WHERE r.checkpoint_id=p.checkpoint_id)<>json_array_length(p.payload_json,'$.members')))
    OR EXISTS(SELECT 1 FROM follow_up_consumer_retained_reasons r LEFT JOIN follow_up_consumer_checkpoints p ON p.checkpoint_id=r.checkpoint_id
      WHERE (r.consumer_key=NEW.consumer_key OR p.consumer_key=NEW.consumer_key) AND (p.checkpoint_id IS NULL
        OR r.consumer_key<>p.consumer_key OR r.generation<>p.generation
        OR NOT EXISTS(SELECT 1 FROM json_each(p.payload_json,'$.members') m WHERE m.key=r.member_index
          AND json_extract(m.value,'$.candidateId')=r.candidate_id AND json_extract(m.value,'$.kind')=r.kind
          AND json_extract(m.value,'$.identity')=r.identity AND json_extract(m.value,'$.reasonCode')=r.reason_code)))
    THEN RAISE(ABORT,'consumer_retention_gap') END);
  -- Revalidate the recorded prefix as a SET, not only its last anchor. Counts
  -- are record counts, never sequence arithmetic: allocation gaps are legal.
  -- This is a SQL scan with bounded output, not a production capacity promise.
  SELECT (CASE WHEN (SELECT COUNT(*) FROM follow_up_effect_evidence_events e WHERE e.sequence<=COALESCE(
      (SELECT p.prefix_sequence FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id),0))
    <>COALESCE((SELECT SUM(json_array_length(p.payload_json,'$.rows')) FROM follow_up_consumer_checkpoints p WHERE p.consumer_key=NEW.consumer_key),0)
    OR EXISTS(SELECT 1 FROM follow_up_consumer_checkpoints p JOIN json_each(p.payload_json,'$.rows') r
      LEFT JOIN follow_up_consumer_journal_v1 e ON e.sequence=json_extract(r.value,'$.sequence')
      WHERE p.consumer_key=NEW.consumer_key AND (e.sequence IS NULL OR e.valid<>1 OR e.event_digest_sha256<>json_extract(r.value,'$.eventDigestSha256')))
    THEN RAISE(ABORT,'consumer_retention_gap') END);
  SELECT (CASE WHEN json_type(NEW.payload_json,'$.members')<>'array' OR json_array_length(NEW.payload_json,'$.members')>2800
    OR json_type(NEW.payload_json,'$.rows')<>'array' OR json_array_length(NEW.payload_json,'$.rows')>200
    OR NEW.cumulative_member_count<>COALESCE((SELECT p.cumulative_member_count FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id),0)+json_array_length(NEW.payload_json,'$.members')
    THEN RAISE(ABORT,'consumer_payload_invalid') END);
  SELECT (CASE WHEN NEW.evidence_valid_until IS NOT NULL AND NEW.evidence_valid_until<=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    THEN RAISE(ABORT,'consumer_retention_gap') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id
    AND ((p.evidence_valid_until IS NOT NULL AND (NEW.evidence_valid_until IS NULL OR NEW.evidence_valid_until>p.evidence_valid_until))
      OR NEW.prefix_sequence<p.prefix_sequence
      OR (p.window_complete=0 AND (NEW.window_high_sequence<>p.window_high_sequence OR NEW.window_event_id_sha256 IS NOT p.window_event_id_sha256 OR NEW.window_event_digest IS NOT p.window_event_digest))))
    THEN RAISE(ABORT,'consumer_boundary_conflict') END);
  SELECT (CASE WHEN NEW.operation_page>0 AND NOT EXISTS(SELECT 1 FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id
    AND p.operation_id=NEW.operation_id AND p.operation_kind=NEW.operation_kind AND p.operation_digest=NEW.operation_digest
    AND p.operation_page=NEW.operation_page-1 AND p.operation_complete=0)
    THEN RAISE(ABORT,'consumer_operation_conflict') END);
  SELECT (CASE WHEN NEW.operation_page=0 AND EXISTS(SELECT 1 FROM follow_up_consumer_checkpoints p
    WHERE p.checkpoint_id=NEW.previous_checkpoint_id AND p.operation_complete<>1)
    THEN RAISE(ABORT,'consumer_operation_conflict') END);
  SELECT (CASE WHEN NEW.operation_kind='inputs' AND (NEW.operation_page<>0 OR NEW.operation_complete<>1 OR json_array_length(NEW.payload_json,'$.rows')<>0
    OR NEW.prefix_sequence<>COALESCE((SELECT p.prefix_sequence FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id),0)
    OR NEW.window_high_sequence<>COALESCE((SELECT p.window_high_sequence FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id),0))
    THEN RAISE(ABORT,'consumer_boundary_conflict') END);
  SELECT (CASE WHEN NEW.operation_kind='journal' AND (
    json_array_length(NEW.payload_json,'$.rows')<>(SELECT COUNT(*) FROM follow_up_effect_evidence_events e
      WHERE e.sequence>COALESCE((SELECT p.prefix_sequence FROM follow_up_consumer_checkpoints p WHERE p.checkpoint_id=NEW.previous_checkpoint_id),0) AND e.sequence<=NEW.prefix_sequence)
    OR EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.rows') item LEFT JOIN follow_up_consumer_journal_v1 e ON e.sequence=json_extract(item.value,'$.sequence')
      WHERE e.sequence IS NULL OR e.valid<>1 OR e.event_digest_sha256<>json_extract(item.value,'$.eventDigestSha256'))
    OR (NEW.prefix_sequence>0 AND NOT EXISTS(SELECT 1 FROM follow_up_consumer_journal_v1 e WHERE e.sequence=NEW.prefix_sequence AND e.valid=1 AND e.event_digest_sha256=NEW.prefix_event_digest))
    OR (NEW.window_high_sequence>0 AND NOT EXISTS(SELECT 1 FROM follow_up_consumer_journal_v1 e WHERE e.sequence=NEW.window_high_sequence AND e.valid=1 AND e.event_digest_sha256=NEW.window_event_digest)))
    THEN RAISE(ABORT,'consumer_source_changed') END);
END;

CREATE TRIGGER follow_up_consumer_reason_guard BEFORE INSERT ON follow_up_consumer_retained_reasons
BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM follow_up_consumer_retained_reasons r WHERE r.checkpoint_id=NEW.checkpoint_id
    AND (r.member_index=NEW.member_index OR (r.candidate_id=NEW.candidate_id AND r.reason_code=NEW.reason_code)))
    THEN RAISE(ABORT,'consumer_reason_conflict') END);
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM follow_up_consumer_checkpoints p JOIN json_each(p.payload_json,'$.members') m
    WHERE p.checkpoint_id=NEW.checkpoint_id AND p.consumer_key=NEW.consumer_key AND p.generation=NEW.generation
      AND m.key=NEW.member_index AND json_extract(m.value,'$.candidateId')=NEW.candidate_id
      AND json_extract(m.value,'$.kind')=NEW.kind AND json_extract(m.value,'$.identity')=NEW.identity AND json_extract(m.value,'$.reasonCode')=NEW.reason_code)
    THEN RAISE(ABORT,'consumer_reason_invalid') END);
END;
CREATE TRIGGER follow_up_consumer_retain_members AFTER INSERT ON follow_up_consumer_checkpoints
BEGIN
  INSERT INTO follow_up_consumer_retained_reasons(checkpoint_id,member_index,consumer_key,generation,candidate_id,kind,identity,reason_code)
  SELECT NEW.checkpoint_id,m.key,NEW.consumer_key,NEW.generation,json_extract(m.value,'$.candidateId'),json_extract(m.value,'$.kind'),
    json_extract(m.value,'$.identity'),json_extract(m.value,'$.reasonCode') FROM json_each(NEW.payload_json,'$.members') m;
  SELECT (CASE WHEN (SELECT COUNT(*) FROM follow_up_consumer_retained_reasons r WHERE r.checkpoint_id=NEW.checkpoint_id)<>json_array_length(NEW.payload_json,'$.members')
    THEN RAISE(ABORT,'consumer_retention_gap') END);
END;
CREATE TRIGGER follow_up_consumer_checkpoints_no_update BEFORE UPDATE ON follow_up_consumer_checkpoints BEGIN SELECT RAISE(ABORT,'consumer_checkpoint_immutable'); END;
CREATE TRIGGER follow_up_consumer_checkpoints_no_delete BEFORE DELETE ON follow_up_consumer_checkpoints BEGIN SELECT RAISE(ABORT,'consumer_checkpoint_immutable'); END;
CREATE TRIGGER follow_up_consumer_reasons_no_update BEFORE UPDATE ON follow_up_consumer_retained_reasons BEGIN SELECT RAISE(ABORT,'consumer_reason_immutable'); END;
CREATE TRIGGER follow_up_consumer_reasons_no_delete BEFORE DELETE ON follow_up_consumer_retained_reasons BEGIN SELECT RAISE(ABORT,'consumer_reason_immutable'); END;
