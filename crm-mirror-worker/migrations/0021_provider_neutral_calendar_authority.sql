-- Preserve the owned appointment command contract while allowing a reviewed
-- non-GHL practitioner-calendar edge. Existing GHL rows remain byte-for-byte
-- compatible; the new provider calendar checkpoint is needed for exact
-- reschedule reconstruction. Lifecycle identity is owned/service based, so a
-- non-GHL event does not invent a provider contact.

ALTER TABLE appointment_authority_commands ADD COLUMN provider_calendar_id TEXT;

CREATE TABLE appointment_lifecycle_dispatches_provider_neutral (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE
    REFERENCES appointment_authority_commands(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL
    REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL
    REFERENCES contacts(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL
    REFERENCES services(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('ghl', 'google_calendar')),
  provider_contact_id TEXT,
  provider_appointment_id TEXT NOT NULL,
  provider_calendar_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('confirmed', 'cancelled')),
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
  updated_at TEXT NOT NULL,
  CHECK (provider <> 'ghl' OR provider_contact_id IS NOT NULL)
);

INSERT INTO appointment_lifecycle_dispatches_provider_neutral (
  id, command_id, appointment_id, contact_id, service_id, provider,
  provider_contact_id, provider_appointment_id, provider_calendar_id,
  event_type, start_at, payload_sha256, state, attempts, lease_until,
  engine_result_json, last_error, dispatched_at, created_at, updated_at
)
SELECT
  id, command_id, appointment_id, contact_id, service_id, provider,
  provider_contact_id, provider_appointment_id, provider_calendar_id,
  event_type, start_at, payload_sha256, state, attempts, lease_until,
  engine_result_json, last_error, dispatched_at, created_at, updated_at
FROM appointment_lifecycle_dispatches;

DROP TABLE appointment_lifecycle_dispatches;
ALTER TABLE appointment_lifecycle_dispatches_provider_neutral
  RENAME TO appointment_lifecycle_dispatches;

CREATE INDEX idx_appointment_lifecycle_dispatches_due
  ON appointment_lifecycle_dispatches(state, lease_until, updated_at);
CREATE INDEX idx_appointment_lifecycle_dispatches_appointment
  ON appointment_lifecycle_dispatches(appointment_id, created_at);
