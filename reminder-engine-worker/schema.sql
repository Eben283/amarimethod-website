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
