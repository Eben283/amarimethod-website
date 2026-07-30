-- Amari Ops visibility spine (Phase 1) — apply to the SHARED amari-automation D1
-- (same database as reminder-engine-worker/schema.sql + db/purchase-cluster-schema.sql).
--   npx wrangler d1 execute amari-automation --remote --file=db/ops-visibility-schema.sql
-- Consumers: functions/lib/ops-events.js (+ webhook / create-checkout emitters) and
-- series-reconcile-worker ops-laws sweep. Binding: AUTOMATION_DB.

-- Append-only hop records. Short trail for path → why (not a warehouse).
CREATE TABLE IF NOT EXISTS ops_events (
  id                   TEXT PRIMARY KEY,
  at                   TEXT NOT NULL,
  at_ms                INTEGER NOT NULL,
  path_id              TEXT NOT NULL,
  hop_id               TEXT NOT NULL,
  outcome              TEXT NOT NULL, -- ok | skip | fail
  reason_code          TEXT,
  summary              TEXT NOT NULL,
  correlation_id       TEXT,
  contact_id           TEXT,
  person_label         TEXT,
  trigger_type         TEXT,
  trigger_id           TEXT,
  condition_expected   TEXT,
  condition_observed   TEXT,
  message_json         TEXT,
  money_json           TEXT,
  source               TEXT
);
CREATE INDEX IF NOT EXISTS idx_ops_evt_path_at ON ops_events (path_id, at_ms);
CREATE INDEX IF NOT EXISTS idx_ops_evt_contact_at ON ops_events (contact_id, at_ms);
CREATE INDEX IF NOT EXISTS idx_ops_evt_corr ON ops_events (correlation_id, at_ms);
CREATE INDEX IF NOT EXISTS idx_ops_evt_hop_outcome ON ops_events (path_id, hop_id, outcome, at_ms);

-- Rolled-up unhealthy path for a person/run. Flip alerts fire when status → open.
CREATE TABLE IF NOT EXISTS ops_incidents (
  id               TEXT PRIMARY KEY,
  path_id          TEXT NOT NULL,
  status           TEXT NOT NULL, -- open | resolved
  severity         TEXT NOT NULL, -- money | booking | wrong_message | infra
  opened_at        TEXT NOT NULL,
  opened_at_ms     INTEGER NOT NULL,
  resolved_at      TEXT,
  last_alerted_at  TEXT,
  title            TEXT NOT NULL,
  contact_id       TEXT,
  person_label     TEXT,
  correlation_id   TEXT,
  failed_hop_id    TEXT,
  event_ids_json   TEXT NOT NULL DEFAULT '[]',
  law_id           TEXT
);
CREATE INDEX IF NOT EXISTS idx_ops_inc_status ON ops_incidents (status, opened_at_ms);
CREATE INDEX IF NOT EXISTS idx_ops_inc_path_status ON ops_incidents (path_id, status);
CREATE INDEX IF NOT EXISTS idx_ops_inc_corr ON ops_incidents (path_id, correlation_id, status);
