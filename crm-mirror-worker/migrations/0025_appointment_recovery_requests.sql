-- Client-requested review boundary for a missed owned appointment.
--
-- This is intentionally not a booking, credit, entitlement, payment, or
-- communication command. The public signed link may only append one pending
-- Staff-review request for the exact missed appointment revision.

CREATE TABLE IF NOT EXISTS appointment_recovery_requests (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  appointment_revision INTEGER NOT NULL CHECK (appointment_revision >= 1),
  request_sha256 TEXT NOT NULL CHECK (
    length(request_sha256) = 64
    AND request_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (state IN ('pending_review', 'approved', 'declined', 'withdrawn')),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (appointment_id, contact_id, appointment_revision),
  CHECK (
    (state = 'pending_review' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR
    (state IN ('approved', 'declined', 'withdrawn') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_appointment_recovery_requests_queue
  ON appointment_recovery_requests(state, requested_at, id);

CREATE TABLE IF NOT EXISTS appointment_recovery_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES appointment_recovery_requests(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('client_requested', 'staff_approved', 'staff_declined', 'client_withdrew')),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointment_recovery_request_events_request
  ON appointment_recovery_request_events(request_id, occurred_at, id);

CREATE TRIGGER IF NOT EXISTS appointment_recovery_requests_no_delete
BEFORE DELETE ON appointment_recovery_requests
BEGIN SELECT RAISE(ABORT, 'appointment recovery requests cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS appointment_recovery_requests_identity_immutable
BEFORE UPDATE ON appointment_recovery_requests
WHEN NEW.id <> OLD.id
  OR NEW.appointment_id <> OLD.appointment_id
  OR NEW.contact_id <> OLD.contact_id
  OR NEW.appointment_revision <> OLD.appointment_revision
  OR NEW.request_sha256 <> OLD.request_sha256
  OR NEW.requested_at <> OLD.requested_at
BEGIN SELECT RAISE(ABORT, 'appointment recovery request identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS appointment_recovery_requests_transition_guard
BEFORE UPDATE OF state ON appointment_recovery_requests
WHEN NOT (
  OLD.state = 'pending_review'
  AND NEW.state IN ('approved', 'declined', 'withdrawn')
)
BEGIN SELECT RAISE(ABORT, 'invalid appointment recovery request transition'); END;

CREATE TRIGGER IF NOT EXISTS appointment_recovery_request_events_no_update
BEFORE UPDATE ON appointment_recovery_request_events
BEGIN SELECT RAISE(ABORT, 'appointment recovery request events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS appointment_recovery_request_events_no_delete
BEFORE DELETE ON appointment_recovery_request_events
BEGIN SELECT RAISE(ABORT, 'appointment recovery request events are append-only'); END;
