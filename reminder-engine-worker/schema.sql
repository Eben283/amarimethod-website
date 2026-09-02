-- Reminder engine — D1 schema (single state spine per DASHBOARD-PLAN observability contract).
-- Apply: npx wrangler d1 execute <db> --file=schema.sql  (remote once the DB is created).

-- One row per (flow, appointment). enrollment_id = `${flow_key}:${appointment_id}`.
CREATE TABLE IF NOT EXISTS reminder_enrollments (
  enrollment_id  TEXT PRIMARY KEY,
  flow_key       TEXT NOT NULL,
  definition_version INTEGER NOT NULL DEFAULT 1,
  appointment_id TEXT NOT NULL,
  contact_id     TEXT NOT NULL,
  calendar_id    TEXT,
  start_at       TEXT,
  start_ms       INTEGER,
  enrolled_at    INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'   -- active | cancelled | done
);
CREATE INDEX IF NOT EXISTS idx_enr_contact ON reminder_enrollments (contact_id);

-- One row per scheduled step. The due-queue is just a query over this table.
CREATE TABLE IF NOT EXISTS reminder_steps (
  enrollment_id TEXT NOT NULL,
  step_index    INTEGER NOT NULL,
  at            TEXT,
  type          TEXT,
  template      TEXT,
  due_at        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | sent | would_send | failed | skipped | cancelled
  PRIMARY KEY (enrollment_id, step_index)
);
-- The sweep's "what's due" query rides this index.
CREATE INDEX IF NOT EXISTS idx_steps_due ON reminder_steps (status, due_at);

-- Provider-neutral delivery effect journal. A send is claimed durably before a
-- transport is invoked; an identical replay can read the accepted receipt but
-- can never dispatch the same effect twice. These tables are inert until a
-- separately released active workflow calls the owned delivery adapter.
CREATE TABLE IF NOT EXISTS owned_delivery_attempts (
  effect_id           TEXT PRIMARY KEY,
  flow_key            TEXT NOT NULL,
  enrollment_id       TEXT NOT NULL,
  step_index          INTEGER NOT NULL,
  definition_version  INTEGER NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE,
  channel             TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient_sha256    TEXT NOT NULL,
  request_sha256      TEXT NOT NULL,
  provider            TEXT NOT NULL,
  state               TEXT NOT NULL CHECK (state IN ('prepared', 'submitted', 'accepted', 'ambiguous', 'failed_terminal')),
  provider_reference  TEXT,
  error_code          TEXT,
  prepared_at         INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  retention_until     INTEGER NOT NULL,
  UNIQUE (enrollment_id, step_index),
  CHECK (retention_until <= prepared_at + 34560000000),
  CHECK ((state = 'accepted' AND provider_reference IS NOT NULL AND error_code IS NULL)
      OR (state = 'ambiguous' AND provider_reference IS NULL AND error_code IS NOT NULL)
      OR (state IN ('prepared', 'submitted') AND provider_reference IS NULL AND error_code IS NULL)
      OR state = 'failed_terminal'),
  FOREIGN KEY (enrollment_id, step_index)
    REFERENCES reminder_steps(enrollment_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_owned_delivery_state
ON owned_delivery_attempts (state, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_delivery_provider_reference
ON owned_delivery_attempts (provider, provider_reference)
WHERE provider_reference IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS owned_delivery_attempt_identity_immutable
BEFORE UPDATE ON owned_delivery_attempts
WHEN NEW.effect_id <> OLD.effect_id
  OR NEW.flow_key <> OLD.flow_key
  OR NEW.enrollment_id <> OLD.enrollment_id
  OR NEW.step_index <> OLD.step_index
  OR NEW.definition_version <> OLD.definition_version
  OR NEW.idempotency_key <> OLD.idempotency_key
  OR NEW.channel <> OLD.channel
  OR NEW.recipient_sha256 <> OLD.recipient_sha256
  OR NEW.request_sha256 <> OLD.request_sha256
  OR NEW.provider <> OLD.provider
  OR NEW.retention_until <> OLD.retention_until
BEGIN
  SELECT RAISE(ABORT, 'owned delivery attempt identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS owned_delivery_attempt_no_delete
BEFORE DELETE ON owned_delivery_attempts
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'owned delivery attempts are retained evidence');
END;

CREATE TRIGGER IF NOT EXISTS owned_delivery_attempt_transition_guard
BEFORE UPDATE OF state ON owned_delivery_attempts
WHEN NEW.state <> OLD.state
 AND NOT (
   (OLD.state = 'prepared' AND NEW.state = 'submitted')
   OR (OLD.state = 'submitted' AND NEW.state IN ('accepted', 'ambiguous', 'failed_terminal'))
 )
BEGIN
  SELECT RAISE(ABORT, 'owned delivery attempt transition is invalid');
END;

CREATE TABLE IF NOT EXISTS owned_delivery_effect_events (
  event_id          TEXT PRIMARY KEY,
  effect_id         TEXT NOT NULL REFERENCES owned_delivery_attempts(effect_id),
  sequence          INTEGER NOT NULL,
  transition        TEXT NOT NULL CHECK (transition IN ('prepared', 'submitted', 'accepted', 'ambiguous', 'failed_terminal')),
  evidence_sha256   TEXT NOT NULL,
  occurred_at       INTEGER NOT NULL,
  retention_until   INTEGER NOT NULL,
  UNIQUE (effect_id, sequence),
  CHECK (retention_until <= occurred_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_owned_delivery_events
ON owned_delivery_effect_events (effect_id, sequence);

CREATE TRIGGER IF NOT EXISTS owned_delivery_events_no_update
BEFORE UPDATE ON owned_delivery_effect_events BEGIN
  SELECT RAISE(ABORT, 'owned delivery effect events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS owned_delivery_events_no_delete
BEFORE DELETE ON owned_delivery_effect_events
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'owned delivery effect events are append-only');
END;

CREATE TABLE IF NOT EXISTS owned_delivery_receipts (
  provider_receipt_id TEXT PRIMARY KEY,
  effect_id           TEXT NOT NULL REFERENCES owned_delivery_attempts(effect_id),
  provider            TEXT NOT NULL,
  provider_reference  TEXT NOT NULL,
  proof_level         TEXT NOT NULL CHECK (proof_level IN ('accepted', 'delivered', 'failed', 'bounced', 'unknown')),
  evidence_sha256     TEXT NOT NULL,
  observed_at         INTEGER NOT NULL,
  retention_until     INTEGER NOT NULL,
  UNIQUE (provider, provider_reference, proof_level, evidence_sha256),
  CHECK (retention_until <= observed_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_owned_delivery_receipts
ON owned_delivery_receipts (effect_id, observed_at);

CREATE TRIGGER IF NOT EXISTS owned_delivery_receipts_no_update
BEFORE UPDATE ON owned_delivery_receipts BEGIN
  SELECT RAISE(ABORT, 'owned delivery receipts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS owned_delivery_receipts_no_delete
BEFORE DELETE ON owned_delivery_receipts
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'owned delivery receipts are append-only');
END;

-- Append-only execution log — what the dashboard reads. Shared across engines by `engine`.
CREATE TABLE IF NOT EXISTS automation_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  engine         TEXT,
  flow_key       TEXT,
  definition_version INTEGER,
  contact_id     TEXT,
  appointment_id TEXT,
  step_index     INTEGER,
  action         TEXT,     -- enrolled | would_send | send | cancelled | exited
  outcome        TEXT,     -- would_send | sent | delivered | failed | bounced | cancelled | ...
  channel        TEXT,     -- sms | email
  message_ref    TEXT,     -- transport message id (not the body — PII posture, see DASHBOARD-PLAN)
  detail         TEXT      -- JSON string
);
CREATE INDEX IF NOT EXISTS idx_evt_contact ON automation_events (contact_id, ts);
CREATE INDEX IF NOT EXISTS idx_evt_flow ON automation_events (flow_key, ts);
CREATE INDEX IF NOT EXISTS idx_evt_engine_flow ON automation_events (engine, flow_key, ts);

-- Execution evidence is immutable. Corrections are represented by a new event, never by
-- rewriting or deleting the original evidence row.
CREATE TRIGGER IF NOT EXISTS automation_events_no_update
BEFORE UPDATE ON automation_events
BEGIN
  SELECT RAISE(ABORT, 'automation_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS automation_events_no_delete
BEFORE DELETE ON automation_events
BEGIN
  SELECT RAISE(ABORT, 'automation_events is append-only');
END;

-- Canonical workflow documents. Published versions are immutable; editing always creates a draft.
CREATE TABLE IF NOT EXISTS workflow_versions (
  workflow_id  TEXT NOT NULL,
  version      INTEGER NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('draft', 'published', 'retired')),
  document     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  published_at INTEGER,
  PRIMARY KEY (workflow_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_one_published
ON workflow_versions (workflow_id) WHERE state = 'published';

-- Reliability spine v1 — additive and inert until a separately reviewed runtime route imports it.
-- This is the authoritative durable contract for one lifecycle family at a time. Legacy
-- processed_events, reminder_enrollments, reminder_steps, and automation_events remain migration
-- evidence only; none is promoted into these tables automatically.
CREATE TABLE IF NOT EXISTS reliability_schema_versions (
  version      INTEGER PRIMARY KEY,
  applied_at   INTEGER NOT NULL,
  migration_id TEXT NOT NULL,
  description  TEXT NOT NULL
);
INSERT OR IGNORE INTO reliability_schema_versions (version, applied_at, migration_id, description)
VALUES (1, CAST(strftime('%s','now') AS INTEGER) * 1000, 'reliability-spine-v1',
        'Durable source events, lifecycle instances, obligations, receipts, reconciliation, and exceptions');

CREATE TABLE IF NOT EXISTS source_events (
  source_event_id       TEXT PRIMARY KEY,
  provider              TEXT NOT NULL,
  family                TEXT NOT NULL,
  provider_event_id     TEXT,
  identity_version      INTEGER NOT NULL,
  identity_key          TEXT NOT NULL UNIQUE,
  payload_sha256        TEXT NOT NULL,
  payload_reference     TEXT,
  raw_retention_until   INTEGER,
  normalized_retention_until INTEGER NOT NULL,
  occurred_at           INTEGER NOT NULL,
  received_at           INTEGER NOT NULL,
  authentication_result TEXT NOT NULL CHECK (authentication_result IN ('authenticated', 'rejected')),
  normalization_state   TEXT NOT NULL CHECK (normalization_state IN ('normalized', 'rejected', 'ambiguous')),
  normalized_json       TEXT,
  rejection_reason      TEXT,
  state                 TEXT NOT NULL CHECK (state IN ('accepted', 'rejected')),
  source_version        TEXT NOT NULL,
  runtime_version       TEXT NOT NULL,
  accepted_at           INTEGER,
  created_at            INTEGER NOT NULL,
  CHECK ((state = 'accepted' AND authentication_result = 'authenticated' AND normalization_state = 'normalized' AND accepted_at IS NOT NULL)
      OR (state = 'rejected' AND rejection_reason IS NOT NULL)),
  CHECK (raw_retention_until IS NULL OR raw_retention_until <= received_at + 2592000000),
  CHECK (normalized_retention_until <= received_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_source_events_received ON source_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_events_provider_event ON source_events (provider, provider_event_id);

CREATE TABLE IF NOT EXISTS source_event_transitions (
  source_transition_id TEXT PRIMARY KEY,
  source_event_id      TEXT NOT NULL REFERENCES source_events(source_event_id),
  sequence             INTEGER NOT NULL,
  transition           TEXT NOT NULL CHECK (transition IN ('received', 'authenticated', 'normalized', 'accepted', 'rejected', 'deduplicated', 'dispatched')),
  occurred_at          INTEGER NOT NULL,
  detail_json          TEXT,
  retention_until      INTEGER NOT NULL,
  UNIQUE (source_event_id, sequence),
  CHECK (sequence > 0),
  CHECK (retention_until <= occurred_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_source_transitions ON source_event_transitions (source_event_id, sequence);
CREATE TRIGGER IF NOT EXISTS source_transitions_no_update
BEFORE UPDATE ON source_event_transitions BEGIN
  SELECT RAISE(ABORT, 'source_event_transitions is append-only');
END;
CREATE TRIGGER IF NOT EXISTS source_transitions_no_delete
BEFORE DELETE ON source_event_transitions
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'source_event_transitions retained until retention_until');
END;

CREATE TRIGGER IF NOT EXISTS source_events_no_update
BEFORE UPDATE ON source_events BEGIN
  SELECT RAISE(ABORT, 'source_events is immutable');
END;
CREATE TRIGGER IF NOT EXISTS source_events_no_delete
BEFORE DELETE ON source_events
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.normalized_retention_until BEGIN
  SELECT RAISE(ABORT, 'source_events is immutable');
END;

CREATE TABLE IF NOT EXISTS lifecycle_instances (
  lifecycle_instance_id TEXT PRIMARY KEY,
  source_event_id        TEXT NOT NULL UNIQUE REFERENCES source_events(source_event_id),
  family                 TEXT NOT NULL,
  scope                  TEXT NOT NULL,
  person_id              TEXT NOT NULL,
  appointment_id         TEXT NOT NULL,
  definition_version     INTEGER NOT NULL,
  runtime_version        TEXT NOT NULL,
  state                  TEXT NOT NULL CHECK (state IN ('active', 'superseded', 'cancelled', 'completed', 'exception')),
  retention_until        INTEGER NOT NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK (retention_until <= created_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_person ON lifecycle_instances (person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_appointment ON lifecycle_instances (appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_family_state ON lifecycle_instances (family, state, created_at DESC);

CREATE TABLE IF NOT EXISTS lifecycle_obligations (
  obligation_id          TEXT PRIMARY KEY,
  lifecycle_instance_id  TEXT NOT NULL REFERENCES lifecycle_instances(lifecycle_instance_id),
  obligation_key         TEXT NOT NULL,
  kind                   TEXT NOT NULL,
  family                 TEXT NOT NULL,
  deadline_at            INTEGER NOT NULL,
  owner_role             TEXT NOT NULL,
  closer                 TEXT NOT NULL,
  state                  TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'satisfied', 'skipped', 'cancelled', 'overdue_exception')),
  lease_owner            TEXT,
  lease_acquired_at      INTEGER,
  lease_expires_at       INTEGER,
  retention_until        INTEGER NOT NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  UNIQUE (lifecycle_instance_id, obligation_key),
  CHECK ((state = 'leased' AND lease_owner IS NOT NULL AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (state <> 'leased')),
  CHECK (retention_until <= created_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_obligations_due ON lifecycle_obligations (state, deadline_at);
CREATE INDEX IF NOT EXISTS idx_obligations_lease ON lifecycle_obligations (state, lease_expires_at);

CREATE TABLE IF NOT EXISTS obligation_lease_events (
  lease_event_id       TEXT PRIMARY KEY,
  obligation_id       TEXT NOT NULL REFERENCES lifecycle_obligations(obligation_id),
  event_type           TEXT NOT NULL CHECK (event_type IN ('acquired', 'taken_over')),
  previous_owner       TEXT,
  new_owner            TEXT NOT NULL,
  lease_acquired_at    INTEGER NOT NULL,
  lease_expires_at     INTEGER NOT NULL,
  retention_until      INTEGER NOT NULL,
  CHECK (retention_until <= lease_acquired_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_lease_events ON obligation_lease_events (obligation_id, lease_acquired_at);
CREATE TRIGGER IF NOT EXISTS lease_events_no_update
BEFORE UPDATE ON obligation_lease_events BEGIN
  SELECT RAISE(ABORT, 'obligation_lease_events is append-only');
END;

CREATE TABLE IF NOT EXISTS command_attempts (
  command_attempt_id     TEXT PRIMARY KEY,
  obligation_id          TEXT NOT NULL REFERENCES lifecycle_obligations(obligation_id),
  idempotency_key        TEXT NOT NULL,
  attempt_number         INTEGER NOT NULL,
  retry_class            TEXT NOT NULL CHECK (retry_class IN ('provider_idempotent', 'amari_reconcile', 'manual_ambiguous')),
  target                 TEXT NOT NULL,
  request_sha256         TEXT NOT NULL,
  rendered_copy_sha256   TEXT,
  provider_reference     TEXT,
  state                  TEXT NOT NULL CHECK (state IN ('prepared', 'leased', 'submitted', 'accepted', 'ambiguous', 'failed_retryable', 'failed_terminal', 'reconciled')),
  error_code             TEXT,
  retention_until        INTEGER NOT NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  UNIQUE (idempotency_key, attempt_number),
  CHECK (retention_until <= created_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_command_obligation ON command_attempts (obligation_id, attempt_number);

CREATE TABLE IF NOT EXISTS provider_receipts (
  provider_receipt_id    TEXT PRIMARY KEY,
  command_attempt_id     TEXT NOT NULL REFERENCES command_attempts(command_attempt_id),
  provider               TEXT NOT NULL,
  provider_reference     TEXT NOT NULL,
  proof_level            TEXT NOT NULL CHECK (proof_level IN ('accepted', 'delivered', 'failed', 'bounced', 'unknown')),
  evidence_sha256        TEXT NOT NULL,
  observed_at            INTEGER NOT NULL,
  retention_until        INTEGER NOT NULL,
  created_at             INTEGER NOT NULL,
  UNIQUE (provider, provider_reference, proof_level, evidence_sha256),
  CHECK (retention_until <= created_at + 34560000000)
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  reconciliation_run_id TEXT PRIMARY KEY,
  family                 TEXT NOT NULL,
  authority              TEXT NOT NULL,
  source_version         TEXT NOT NULL,
  runtime_version        TEXT NOT NULL,
  started_at             INTEGER NOT NULL,
  completed_at           INTEGER,
  expected_start         INTEGER NOT NULL,
  expected_end           INTEGER NOT NULL,
  coverage_start         INTEGER NOT NULL,
  coverage_end           INTEGER NOT NULL,
  pagination_complete    INTEGER NOT NULL DEFAULT 0 CHECK (pagination_complete IN (0, 1)),
  state                  TEXT NOT NULL CHECK (state IN ('running', 'complete', 'degraded', 'failed')),
  detail_json            TEXT,
  retention_until        INTEGER NOT NULL,
  CHECK (retention_until <= started_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_family ON reconciliation_runs (family, started_at DESC);

CREATE TABLE IF NOT EXISTS lifecycle_exceptions (
  exception_id           TEXT PRIMARY KEY,
  family                 TEXT NOT NULL,
  source_event_id        TEXT REFERENCES source_events(source_event_id),
  lifecycle_instance_id  TEXT REFERENCES lifecycle_instances(lifecycle_instance_id),
  obligation_id          TEXT REFERENCES lifecycle_obligations(obligation_id),
  kind                   TEXT NOT NULL,
  severity               TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  accountable_owner      TEXT NOT NULL,
  next_safe_action       TEXT NOT NULL,
  state                  TEXT NOT NULL CHECK (state IN ('open', 'acknowledged', 'investigating', 'resolved', 'suppressed_with_expiry')),
  suppression_expires_at INTEGER,
  retention_until        INTEGER NOT NULL,
  opened_at              INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK (state <> 'suppressed_with_expiry' OR suppression_expires_at IS NOT NULL),
  CHECK (retention_until <= opened_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_exceptions_queue ON lifecycle_exceptions (state, severity, opened_at);
CREATE INDEX IF NOT EXISTS idx_exceptions_family_queue ON lifecycle_exceptions (family, state, severity, opened_at);

CREATE TABLE IF NOT EXISTS exception_events (
  exception_event_id TEXT PRIMARY KEY,
  exception_id       TEXT NOT NULL REFERENCES lifecycle_exceptions(exception_id),
  event_type         TEXT NOT NULL CHECK (event_type IN ('opened', 'acknowledged', 'investigating', 'resolved', 'suppressed', 'reopened')),
  actor              TEXT NOT NULL,
  occurred_at        INTEGER NOT NULL,
  evidence_sha256    TEXT,
  detail_json        TEXT,
  retention_until    INTEGER NOT NULL,
  CHECK (retention_until <= occurred_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_exception_events ON exception_events (exception_id, occurred_at);
CREATE TRIGGER IF NOT EXISTS exception_events_no_update
BEFORE UPDATE ON exception_events BEGIN
  SELECT RAISE(ABORT, 'exception_events is append-only');
END;

CREATE TABLE IF NOT EXISTS evidence_access_events (
  access_event_id  TEXT PRIMARY KEY,
  actor            TEXT NOT NULL,
  family           TEXT NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('view_summary', 'view_source', 'export')),
  source_event_id  TEXT,
  occurred_at      INTEGER NOT NULL,
  retention_until INTEGER NOT NULL,
  CHECK (retention_until <= occurred_at + 34560000000)
);
CREATE INDEX IF NOT EXISTS idx_evidence_access ON evidence_access_events (family, occurred_at DESC);
CREATE TRIGGER IF NOT EXISTS evidence_access_no_update
BEFORE UPDATE ON evidence_access_events BEGIN
  SELECT RAISE(ABORT, 'evidence_access_events is append-only');
END;
CREATE TRIGGER IF NOT EXISTS lease_events_no_delete
BEFORE DELETE ON obligation_lease_events
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'obligation_lease_events retained until retention_until');
END;
CREATE TRIGGER IF NOT EXISTS evidence_access_no_delete
BEFORE DELETE ON evidence_access_events
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'evidence_access_events retained until retention_until');
END;
CREATE TRIGGER IF NOT EXISTS exception_events_no_delete
BEFORE DELETE ON exception_events
WHEN CAST(strftime('%s','now') AS INTEGER) * 1000 < OLD.retention_until BEGIN
  SELECT RAISE(ABORT, 'exception_events is append-only');
END;
