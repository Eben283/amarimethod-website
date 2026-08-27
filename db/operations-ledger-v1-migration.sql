-- Operations Ledger core v1 — durable, append-only operational evidence.
-- Apply to the shared AUTOMATION_DB / amari-automation D1 database.
--
-- The task and release tables are deliberately projections: their current
-- state may be corrected. Every state change must have a corresponding row in
-- ops_audit_events. Audit events and their subject references are permanent.
-- No table in this migration stores names, message bodies, record values, or
-- arbitrary metadata.

CREATE TABLE IF NOT EXISTS ops_tasks (
  id                 TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('todo', 'open', 'in_progress', 'blocked', 'done', 'completed', 'cancelled')),
  priority           TEXT NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  owner_kind         TEXT,
  owner_ref          TEXT,
  source_ref         TEXT,
  due_at             INTEGER,
  request_hash       TEXT NOT NULL,
  created_by_kind    TEXT NOT NULL,
  created_by_ref     TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 200),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (length(title) BETWEEN 1 AND 280),
  CHECK (owner_kind IS NULL OR length(owner_kind) BETWEEN 1 AND 40),
  CHECK (owner_ref IS NULL OR length(owner_ref) BETWEEN 1 AND 200),
  CHECK (source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 200),
  CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*')
);

CREATE INDEX IF NOT EXISTS idx_ops_tasks_status_due
  ON ops_tasks(status, due_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_owner
  ON ops_tasks(owner_kind, owner_ref, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_updated
  ON ops_tasks(updated_at DESC);

CREATE TABLE IF NOT EXISTS ops_audit_events (
  id                 TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL UNIQUE,
  event_type         TEXT NOT NULL,
  summary            TEXT NOT NULL,
  field_names_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(field_names_json)),
  counts_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json)),
  correlation_ref    TEXT,
  task_id            TEXT REFERENCES ops_tasks(id),
  release_id         TEXT REFERENCES ops_releases(id),
  actor_kind         TEXT NOT NULL
                     CHECK (actor_kind IN ('human', 'codex', 'worker', 'github', 'cloudflare')),
  actor_ref          TEXT NOT NULL,
  occurred_at        INTEGER NOT NULL,
  recorded_at        INTEGER NOT NULL,
  request_hash       TEXT NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 200),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (length(event_type) BETWEEN 1 AND 100),
  CHECK (length(summary) BETWEEN 1 AND 280),
  CHECK (correlation_ref IS NULL OR length(correlation_ref) BETWEEN 1 AND 200),
  CHECK (length(actor_ref) BETWEEN 1 AND 200),
  CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*')
);

CREATE INDEX IF NOT EXISTS idx_ops_audit_events_occurred
  ON ops_audit_events(occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ops_audit_events_type
  ON ops_audit_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_audit_events_task
  ON ops_audit_events(task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_audit_events_release
  ON ops_audit_events(release_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_audit_events_correlation
  ON ops_audit_events(correlation_ref, occurred_at DESC);

CREATE TABLE IF NOT EXISTS ops_audit_subjects (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL REFERENCES ops_audit_events(id),
  subject_type       TEXT NOT NULL,
  subject_ref        TEXT NOT NULL,
  field_names_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(field_names_json)),
  counts_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json)),
  created_at         INTEGER NOT NULL,
  CHECK (length(subject_type) BETWEEN 1 AND 80),
  CHECK (length(subject_ref) BETWEEN 1 AND 200),
  UNIQUE(event_id, subject_type, subject_ref)
);

CREATE INDEX IF NOT EXISTS idx_ops_audit_subjects_event
  ON ops_audit_subjects(event_id, id);
CREATE INDEX IF NOT EXISTS idx_ops_audit_subjects_ref
  ON ops_audit_subjects(subject_type, subject_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_releases (
  id                 TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL UNIQUE,
  release_ref        TEXT NOT NULL UNIQUE,
  service_ref        TEXT NOT NULL,
  environment       TEXT NOT NULL,
  version_ref        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'planned'
                     CHECK (status IN ('planned', 'pending', 'queued', 'building', 'active', 'succeeded', 'failed', 'rolled_back', 'cancelled')),
  summary            TEXT NOT NULL,
  source_ref         TEXT,
  request_hash       TEXT NOT NULL,
  created_by_kind    TEXT NOT NULL
                     CHECK (created_by_kind IN ('human', 'codex', 'worker', 'github', 'cloudflare')),
  created_by_ref     TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 200),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (length(release_ref) BETWEEN 1 AND 200),
  CHECK (length(service_ref) BETWEEN 1 AND 120),
  CHECK (length(environment) BETWEEN 1 AND 80),
  CHECK (length(version_ref) BETWEEN 1 AND 200),
  CHECK (length(summary) BETWEEN 1 AND 280),
  CHECK (source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 200),
  CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(created_by_ref) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_ops_releases_status
  ON ops_releases(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_releases_service
  ON ops_releases(service_ref, environment, updated_at DESC);

CREATE TABLE IF NOT EXISTS ops_incident_links (
  id                 TEXT PRIMARY KEY,
  incident_ref       TEXT NOT NULL,
  linked_type        TEXT NOT NULL,
  linked_ref         TEXT NOT NULL,
  relation           TEXT NOT NULL DEFAULT 'related',
  created_by_kind    TEXT NOT NULL
                     CHECK (created_by_kind IN ('human', 'codex', 'worker', 'github', 'cloudflare')),
  created_by_ref     TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  CHECK (length(incident_ref) BETWEEN 1 AND 200),
  CHECK (length(linked_type) BETWEEN 1 AND 80),
  CHECK (length(linked_ref) BETWEEN 1 AND 200),
  CHECK (length(relation) BETWEEN 1 AND 80),
  CHECK (length(created_by_ref) BETWEEN 1 AND 200),
  UNIQUE(incident_ref, linked_type, linked_ref, relation)
);

CREATE INDEX IF NOT EXISTS idx_ops_incident_links_incident
  ON ops_incident_links(incident_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_incident_links_linked
  ON ops_incident_links(linked_type, linked_ref, created_at DESC);

CREATE TRIGGER IF NOT EXISTS ops_audit_events_reject_update
BEFORE UPDATE ON ops_audit_events
BEGIN
  SELECT RAISE(ABORT, 'ops_audit_events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ops_audit_events_reject_delete
BEFORE DELETE ON ops_audit_events
BEGIN
  SELECT RAISE(ABORT, 'ops_audit_events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ops_audit_subjects_reject_update
BEFORE UPDATE ON ops_audit_subjects
BEGIN
  SELECT RAISE(ABORT, 'ops_audit_subjects are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ops_audit_subjects_reject_delete
BEFORE DELETE ON ops_audit_subjects
BEGIN
  SELECT RAISE(ABORT, 'ops_audit_subjects are append-only');
END;
