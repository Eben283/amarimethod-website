-- Nurture engine — D1 schema. Lives in the SAME database as the reminder engine
-- (amari-automation): one SQL spine, one shared automation_events log, per the
-- DASHBOARD-PLAN observability contract.
-- Apply: npx wrangler d1 execute amari-automation --remote --file=schema.sql

-- One row per (sequence, contact). enrollment_id = `${sequence_id}:${contact_id}`.
-- guard_unchecked flags shadow enrollments made without a tag read (see enroll.js).
CREATE TABLE IF NOT EXISTS nurture_enrollments (
  enrollment_id   TEXT PRIMARY KEY,
  sequence_id     TEXT NOT NULL,
  contact_id      TEXT NOT NULL,
  entered_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | exited | done
  guard_unchecked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nurture_enr_contact ON nurture_enrollments (contact_id);

-- One row per scheduled step. The due-queue is just a query over this table.
-- 'imported' marks steps GHL already owned at cutover (importEnrollment) — never fired by us.
CREATE TABLE IF NOT EXISTS nurture_steps (
  enrollment_id TEXT NOT NULL,
  step_index    INTEGER NOT NULL,
  after         TEXT,
  kind          TEXT,     -- email | branch | branch_map
  template      TEXT,     -- null for branch kinds (resolved fresh at send time)
  due_at        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | sent | would_send | failed | exited | imported
  PRIMARY KEY (enrollment_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_nurture_steps_due ON nurture_steps (status, due_at);

-- Shared append-only execution log — identical definition to reminder-engine-worker/schema.sql
-- (IF NOT EXISTS: whichever engine's schema runs first creates it, the other is a no-op).
CREATE TABLE IF NOT EXISTS automation_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  engine         TEXT,
  flow_key       TEXT,
  contact_id     TEXT,
  appointment_id TEXT,
  step_index     INTEGER,
  action         TEXT,     -- enrolled | would_send | send | cancelled | exited | would_tag | tagged
  outcome        TEXT,     -- would_send | sent | delivered | failed | bounced | cancelled | ...
  channel        TEXT,     -- sms | email
  message_ref    TEXT,     -- transport message id (not the body — PII posture, see DASHBOARD-PLAN)
  detail         TEXT      -- JSON string
);
CREATE INDEX IF NOT EXISTS idx_evt_contact ON automation_events (contact_id, ts);
CREATE INDEX IF NOT EXISTS idx_evt_flow ON automation_events (flow_key, ts);
