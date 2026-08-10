-- Durable Staff cancellation/reschedule commands and append-only audit.
-- Apply once to ATTEND_DB / amari-attendance before publishing the Staff UI.

CREATE TABLE IF NOT EXISTS appointment_commands (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('cancel', 'reschedule')),
  contact_id TEXT NOT NULL,
  source_appointment_id TEXT NOT NULL,
  requested_start_time TEXT,
  replacement_appointment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'retryable', 'completed', 'manual_review')),
  result_json TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(actor, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_appointment_commands_status_lease
  ON appointment_commands(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_appointment_commands_source
  ON appointment_commands(source_appointment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS appointment_command_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES appointment_commands(id),
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  phase TEXT NOT NULL,
  detail_json TEXT,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointment_command_events_command
  ON appointment_command_events(command_id, occurred_at, id);

CREATE TRIGGER IF NOT EXISTS appointment_command_events_require_command_state
BEFORE INSERT ON appointment_command_events
WHEN
  (NEW.phase = 'completed' AND (SELECT status FROM appointment_commands WHERE id = NEW.command_id) <> 'completed') OR
  (NEW.phase = 'retryable' AND (SELECT status FROM appointment_commands WHERE id = NEW.command_id) <> 'retryable') OR
  (NEW.phase = 'manual_review' AND (SELECT status FROM appointment_commands WHERE id = NEW.command_id) <> 'manual_review') OR
  (NEW.phase = 'replacement_created' AND (SELECT replacement_appointment_id FROM appointment_commands WHERE id = NEW.command_id) IS NULL) OR
  (NEW.phase = 'replacement_compensated' AND (SELECT replacement_appointment_id FROM appointment_commands WHERE id = NEW.command_id) IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'appointment command event does not match command state');
END;

CREATE TRIGGER IF NOT EXISTS appointment_command_events_reject_update
BEFORE UPDATE ON appointment_command_events
BEGIN
  SELECT RAISE(ABORT, 'appointment_command_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS appointment_command_events_reject_delete
BEFORE DELETE ON appointment_command_events
BEGIN
  SELECT RAISE(ABORT, 'appointment_command_events is append-only');
END;
