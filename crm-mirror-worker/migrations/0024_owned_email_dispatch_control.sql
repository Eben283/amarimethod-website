-- Dormant provider-neutral owned communication dispatcher.
--
-- This migration creates command, queue-control, and append-only transition evidence only.
-- It does not activate a source route, OAuth grant, Gmail request, reply sync, SMS provider,
-- customer message, or GHL fallback. Commands captured while source mode is shadow are terminal
-- `shadow_blocked` rows and can never be promoted into pending delivery later.

CREATE TABLE IF NOT EXISTS owned_communication_commands (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  channel TEXT NOT NULL CHECK (channel = 'email'),
  provider TEXT NOT NULL CHECK (provider = 'google_workspace'),
  idempotency_key TEXT NOT NULL,
  subject_clean TEXT NOT NULL,
  body_clean TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  consent_state TEXT NOT NULL CHECK (consent_state IN ('granted', 'revoked', 'unknown')),
  policy_state TEXT NOT NULL CHECK (policy_state IN ('eligible', 'blocked')),
  dnd_state TEXT NOT NULL CHECK (dnd_state IN ('on', 'off')),
  destination_masked TEXT,
  captured_at TEXT NOT NULL,
  UNIQUE (actor, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_owned_communication_commands_contact
  ON owned_communication_commands(contact_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS owned_communication_dispatches (
  command_id TEXT PRIMARY KEY REFERENCES owned_communication_commands(id) ON DELETE RESTRICT,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  state TEXT NOT NULL CHECK (state IN (
    'pending', 'executing', 'retryable', 'submitted', 'submission_unreconciled',
    'policy_blocked', 'shadow_blocked', 'manual_review'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until INTEGER NOT NULL DEFAULT 0 CHECK (lease_until >= 0),
  provider_message_id TEXT,
  last_error_code TEXT,
  submitted_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (state IN ('submitted', 'submission_unreconciled') AND provider_message_id IS NOT NULL AND submitted_at IS NOT NULL)
    OR
    (state NOT IN ('submitted', 'submission_unreconciled') AND provider_message_id IS NULL AND submitted_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_owned_communication_dispatch_queue
  ON owned_communication_dispatches(state, updated_at, command_id);

CREATE TABLE IF NOT EXISTS owned_communication_dispatch_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES owned_communication_commands(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owned_communication_dispatch_events_command
  ON owned_communication_dispatch_events(command_id, occurred_at, id);

CREATE TRIGGER IF NOT EXISTS owned_communication_commands_no_update
BEFORE UPDATE ON owned_communication_commands
BEGIN SELECT RAISE(ABORT, 'owned communication commands are append-only'); END;
CREATE TRIGGER IF NOT EXISTS owned_communication_commands_no_delete
BEFORE DELETE ON owned_communication_commands
BEGIN SELECT RAISE(ABORT, 'owned communication commands are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_communication_dispatch_events_no_update
BEFORE UPDATE ON owned_communication_dispatch_events
BEGIN SELECT RAISE(ABORT, 'owned communication dispatch events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS owned_communication_dispatch_events_no_delete
BEFORE DELETE ON owned_communication_dispatch_events
BEGIN SELECT RAISE(ABORT, 'owned communication dispatch events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_communication_dispatches_no_delete
BEFORE DELETE ON owned_communication_dispatches
BEGIN SELECT RAISE(ABORT, 'owned communication dispatch control cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS owned_communication_dispatches_identity_immutable
BEFORE UPDATE ON owned_communication_dispatches
WHEN NEW.command_id <> OLD.command_id OR NEW.payload_sha256 <> OLD.payload_sha256
BEGIN SELECT RAISE(ABORT, 'owned communication dispatch identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS owned_communication_dispatches_transition_guard
BEFORE UPDATE OF state ON owned_communication_dispatches
WHEN NOT (
  (OLD.state IN ('pending', 'retryable') AND NEW.state IN ('executing', 'manual_review')) OR
  (OLD.state = 'executing' AND NEW.state IN ('retryable', 'submitted', 'submission_unreconciled', 'manual_review'))
)
BEGIN SELECT RAISE(ABORT, 'invalid owned communication dispatch transition'); END;
