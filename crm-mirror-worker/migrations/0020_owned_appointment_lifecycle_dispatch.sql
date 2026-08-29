-- Durable outbox from owned appointment authority into the reminder lifecycle.
--
-- The appointment command commits this row in the same D1 batch as its final
-- owned state. A bounded Worker sweep leases and retries the handoff through a
-- Cloudflare service binding. The downstream reminder enrollment is itself
-- idempotent, so a crash after delivery but before this checkpoint cannot
-- create a second lifecycle.

CREATE TABLE appointment_lifecycle_dispatches (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE
    REFERENCES appointment_authority_commands(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL
    REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL
    REFERENCES contacts(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL
    REFERENCES services(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider = 'ghl'),
  provider_contact_id TEXT NOT NULL,
  provider_appointment_id TEXT NOT NULL,
  provider_calendar_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'confirmed'),
  start_at TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'executing', 'retryable', 'dispatched', 'manual_review')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until INTEGER NOT NULL DEFAULT 0,
  engine_result_json TEXT,
  last_error TEXT,
  dispatched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_appointment_lifecycle_dispatches_due
  ON appointment_lifecycle_dispatches(state, lease_until, updated_at);
CREATE INDEX idx_appointment_lifecycle_dispatches_appointment
  ON appointment_lifecycle_dispatches(appointment_id, created_at);
