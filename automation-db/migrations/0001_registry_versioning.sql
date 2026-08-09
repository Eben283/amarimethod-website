-- Existing amari-automation D1 upgrade for the internal Automation Registry.
-- Apply exactly once before deploying engine code that persists definition_version.
-- Fresh databases should use the engine schema.sql files instead.

ALTER TABLE reminder_enrollments
  ADD COLUMN definition_version INTEGER;

ALTER TABLE nurture_enrollments
  ADD COLUMN definition_version INTEGER;

ALTER TABLE automation_events
  ADD COLUMN definition_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_evt_engine_flow
  ON automation_events (engine, flow_key, ts);

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
