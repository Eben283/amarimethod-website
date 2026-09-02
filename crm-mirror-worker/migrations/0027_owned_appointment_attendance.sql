-- Provider-neutral Staff attendance command authority.
--
-- This schema can atomically mark only an already-owned, provider-free appointment as
-- attended or no-show. It cannot promote appointment authority, write a provider mirror,
-- debit a package, grant a session, send a message, take payment, or decide a recovery
-- request. The source route remains hard-shadow until a separately reviewed cutover.

CREATE TABLE IF NOT EXISTS appointment_attendance_commands (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  idempotency_key TEXT NOT NULL,
  target_status TEXT NOT NULL CHECK (target_status IN ('attended', 'no_show')),
  prior_status TEXT NOT NULL CHECK (
    prior_status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'attended', 'unknown')
  ),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 1),
  result_revision INTEGER NOT NULL CHECK (result_revision >= 1),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'no_change')),
  state TEXT NOT NULL CHECK (state = 'completed'),
  requested_at TEXT NOT NULL CHECK (julianday(requested_at) IS NOT NULL),
  completed_at TEXT NOT NULL CHECK (julianday(completed_at) IS NOT NULL),
  CHECK (
    (outcome = 'applied' AND prior_status <> target_status
      AND result_revision = expected_revision + 1)
    OR
    (outcome = 'no_change' AND prior_status = target_status
      AND result_revision = expected_revision)
  ),
  UNIQUE (actor, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_appointment_attendance_commands_appointment
  ON appointment_attendance_commands(appointment_id, requested_at, id);
CREATE INDEX IF NOT EXISTS idx_appointment_attendance_commands_contact
  ON appointment_attendance_commands(contact_id, requested_at DESC, id);

CREATE TABLE IF NOT EXISTS appointment_attendance_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES appointment_attendance_commands(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('accepted', 'status_applied', 'status_unchanged')
  ),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  occurred_at TEXT NOT NULL CHECK (julianday(occurred_at) IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_appointment_attendance_events_command
  ON appointment_attendance_events(command_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_appointment_attendance_events_appointment
  ON appointment_attendance_events(appointment_id, occurred_at, id);

CREATE TRIGGER IF NOT EXISTS appointment_attendance_commands_no_update
BEFORE UPDATE ON appointment_attendance_commands
BEGIN SELECT RAISE(ABORT, 'appointment attendance commands are append-only'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_commands_no_delete
BEFORE DELETE ON appointment_attendance_commands
BEGIN SELECT RAISE(ABORT, 'appointment attendance commands are append-only'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_events_no_update
BEFORE UPDATE ON appointment_attendance_events
BEGIN SELECT RAISE(ABORT, 'appointment attendance events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_events_no_delete
BEFORE DELETE ON appointment_attendance_events
BEGIN SELECT RAISE(ABORT, 'appointment attendance events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_requires_appointment
BEFORE INSERT ON appointment_attendance_commands
WHEN NOT EXISTS (SELECT 1 FROM appointments WHERE id = NEW.appointment_id)
BEGIN SELECT RAISE(ABORT, 'attendance appointment not found'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_requires_contact
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (SELECT 1 FROM appointments WHERE id = NEW.appointment_id)
 AND NOT EXISTS (
   SELECT 1 FROM appointments
    WHERE id = NEW.appointment_id AND contact_id = NEW.contact_id
 )
BEGIN SELECT RAISE(ABORT, 'attendance contact mismatch'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_requires_revision
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id AND revision <> NEW.expected_revision
)
BEGIN SELECT RAISE(ABORT, 'attendance revision conflict'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_requires_owned_authority
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id
     AND (authority <> 'owned' OR provider_sync_state <> 'not_required')
)
BEGIN SELECT RAISE(ABORT, 'attendance authority unavailable'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_rejects_archived_contact
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (
  SELECT 1 FROM contacts
   WHERE id = NEW.contact_id AND archived_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'attendance contact archived'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_rejects_cancelled
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id AND status = 'cancelled'
)
BEGIN SELECT RAISE(ABORT, 'attendance appointment cancelled'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_requires_start
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id
     AND (starts_at IS NULL OR julianday(starts_at) IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'attendance appointment start unavailable'); END;

-- Staff may mark attendance shortly before a session begins, matching the practical
-- check-in window. A no-show cannot be recorded before the canonical start time.
CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_rejects_early_attended
BEFORE INSERT ON appointment_attendance_commands
WHEN NEW.target_status = 'attended' AND EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id
     AND julianday(NEW.requested_at) < julianday(starts_at, '-2 hours')
)
BEGIN SELECT RAISE(ABORT, 'attendance marking is too early'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_rejects_early_no_show
BEFORE INSERT ON appointment_attendance_commands
WHEN NEW.target_status = 'no_show' AND EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id
     AND julianday(NEW.requested_at) < julianday(starts_at)
)
BEGIN SELECT RAISE(ABORT, 'no-show marking is too early'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_requires_prior_status
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id AND status <> NEW.prior_status
)
BEGIN SELECT RAISE(ABORT, 'attendance status conflict'); END;

CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_requires_outcome
BEFORE INSERT ON appointment_attendance_commands
WHEN EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id
     AND (
       (NEW.outcome = 'applied' AND status = NEW.target_status)
       OR (NEW.outcome = 'no_change' AND status <> NEW.target_status)
     )
)
BEGIN SELECT RAISE(ABORT, 'attendance outcome conflict'); END;

-- One insert is the entire write transaction. The appointment revision update invokes
-- migration 0026's immutable status-fact trigger before this statement commits.
CREATE TRIGGER IF NOT EXISTS appointment_attendance_command_apply
AFTER INSERT ON appointment_attendance_commands
BEGIN
  INSERT INTO appointment_attendance_events (
    id, command_id, appointment_id, event_type, detail_json, occurred_at
  ) VALUES (
    'aat_evt_' || NEW.id || '_accepted', NEW.id, NEW.appointment_id, 'accepted',
    json_object(
      'actor', NEW.actor,
      'priorStatus', NEW.prior_status,
      'targetStatus', NEW.target_status,
      'expectedRevision', NEW.expected_revision,
      'outcome', NEW.outcome
    ),
    NEW.requested_at
  );

  UPDATE appointments
     SET status = NEW.target_status,
         attendance_marked_at = NEW.requested_at,
         attendance_marked_by = NEW.actor,
         revision = revision + 1,
         last_modified_by = NEW.actor,
         updated_at = NEW.requested_at
   WHERE id = NEW.appointment_id AND NEW.outcome = 'applied';

  INSERT INTO appointment_attendance_events (
    id, command_id, appointment_id, event_type, detail_json, occurred_at
  ) VALUES (
    'aat_evt_' || NEW.id || '_result', NEW.id, NEW.appointment_id,
    CASE WHEN NEW.outcome = 'applied' THEN 'status_applied' ELSE 'status_unchanged' END,
    json_object(
      'status', NEW.target_status,
      'resultRevision', NEW.result_revision,
      'providerWrite', 0,
      'sessionLedgerWrite', 0,
      'messageWrite', 0,
      'paymentWrite', 0,
      'authorityPromoted', 0
    ),
    NEW.completed_at
  );
END;
